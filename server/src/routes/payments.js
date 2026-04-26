import { Router } from "express";
import Stripe from "stripe";
import { requireUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { sendSubscriptionConfirmation } from "../services/email.js";

const router = Router();
const DEFAULT_PRICE_CENTS = parseInt(process.env.DEX_PRICE_CENTS || "999", 10);
const DEFAULT_CURRENCY = (process.env.DEX_CURRENCY || "usd").toLowerCase();
const DEFAULT_SUCCESS_URL =
  process.env.STRIPE_SUCCESS_URL ||
  "https://konvict-artz.com/settings?billing=success";
const DEFAULT_CANCEL_URL =
  process.env.STRIPE_CANCEL_URL ||
  "https://konvict-artz.com/settings?billing=cancelled";

function fireAndForget(label, task) {
  Promise.resolve()
    .then(task)
    .catch((err) => {
      console.error(`${label} failed:`, err?.message || err);
    });
}

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY.");
  }
  return new Stripe(secretKey);
}

function getSiteUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return `${req.protocol}://${req.get("host")}`;
}

function getSuccessUrl(req) {
  const siteUrl = process.env.PUBLIC_SITE_URL || getSiteUrl(req);
  return DEFAULT_SUCCESS_URL.replace(/^https?:\/\/[^/]+/i, siteUrl);
}

function getCancelUrl(req) {
  const siteUrl = process.env.PUBLIC_SITE_URL || getSiteUrl(req);
  return DEFAULT_CANCEL_URL.replace(/^https?:\/\/[^/]+/i, siteUrl);
}

function trialDaysForUser(user) {
  if (!user?.trial_start) return 0;
  const trialStart = new Date(user.trial_start);
  const trialEnd = new Date(trialStart);
  trialEnd.setDate(trialEnd.getDate() + 3);
  const remainingMs = trialEnd.getTime() - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
}

async function resolveBillingAccess(db, userId) {
  const user = await db.get(
    "SELECT access_type, trial_start, sub_expires, stripe_customer_id, stripe_subscription_id, role FROM users WHERE id = ?",
    [userId]
  );
  if (!user) return null;

  if (user.role === "admin" || user.access_type === "unlimited") {
    return {
      ...user,
      access_type: "unlimited",
      trialDaysLeft: null,
    };
  }

  let accessType = user.access_type;
  let trialDaysLeft = null;

  if (accessType === "trial" && user.trial_start) {
    const trialEnd = new Date(user.trial_start);
    trialEnd.setDate(trialEnd.getDate() + 3);
    const now = new Date();
    if (now > trialEnd) {
      accessType = "expired";
    } else {
      trialDaysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    }
  }

  if (accessType === "paid" && user.sub_expires && new Date() > new Date(user.sub_expires)) {
    accessType = "expired";
  }

  if (accessType !== user.access_type) {
    await db.run("UPDATE users SET access_type = ? WHERE id = ?", [accessType, userId]);
  }

  return {
    ...user,
    access_type: accessType,
    trialDaysLeft,
  };
}

async function ensureStripeCustomer(stripe, db, user) {
  if (user.stripe_customer_id) {
    return user.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || user.email,
    metadata: {
      user_id: String(user.id),
    },
  });

  await db.run("UPDATE users SET stripe_customer_id = ? WHERE id = ?", [customer.id, user.id]);
  return customer.id;
}

async function markAffiliateCredit(db, user) {
  if (!user.referred_by) return;
  await db.run(
    `UPDATE affiliates
       SET paid_subs = paid_subs + 1,
           earnings = earnings + 2.0
     WHERE promo_code = ?`,
    [user.referred_by]
  );
}

async function syncUserSubscription(db, stripe, subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) return;

  const user = await db.get("SELECT * FROM users WHERE stripe_customer_id = ?", [customerId]);
  if (!user) return;

  let accessType = "paid";
  if (subscription.status === "canceled" || subscription.status === "unpaid" || subscription.status === "past_due") {
    accessType = "expired";
  }

  const subExpires = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const wasPaid = user.access_type === "paid";

  await db.run(
    `UPDATE users
        SET access_type = ?,
            sub_expires = ?,
            stripe_subscription_id = ?,
            stripe_customer_id = ?
      WHERE id = ?`,
    [accessType, subExpires, subscription.id, customerId, user.id]
  );

  if (accessType === "paid" && !wasPaid) {
    await markAffiliateCredit(db, user);
    fireAndForget("Subscription confirmation email", () => sendSubscriptionConfirmation(user.email, user.name));
  }

  return {
    userId: user.id,
    customerId,
    subscription,
    user,
  };
}

async function upsertPaymentRecord(db, values) {
  const existing = await db.get(
    `SELECT id
       FROM payments
      WHERE stripe_checkout_session_id = ?
         OR (stripe_payment_intent_id IS NOT NULL AND stripe_payment_intent_id = ?)
      LIMIT 1`,
    [values.checkoutSessionId || null, values.paymentIntentId || null]
  );

  if (existing) {
    await db.run(
      `UPDATE payments
          SET stripe_payment_intent_id = ?,
              stripe_checkout_session_id = ?,
              stripe_subscription_id = ?,
              amount_cents = ?,
              currency = ?,
              status = ?,
              affiliate_code = ?
        WHERE id = ?`,
      [
        values.paymentIntentId || null,
        values.checkoutSessionId || null,
        values.subscriptionId || null,
        values.amountCents,
        values.currency,
        values.status,
        values.affiliateCode || null,
        existing.id,
      ]
    );
    return existing.id;
  }

  const result = await db.run(
    `INSERT INTO payments (
       user_id,
       square_payment_id,
       stripe_payment_intent_id,
       stripe_checkout_session_id,
       stripe_subscription_id,
       amount_cents,
       currency,
       status,
       affiliate_code
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.userId,
      values.paymentIntentId || null,
      values.checkoutSessionId || null,
      values.subscriptionId || null,
      values.amountCents,
      values.currency,
      values.status,
      values.affiliateCode || null,
    ]
  );

  return result.lastID;
}

async function createCheckoutSession(req, res) {
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(stripe, db, user);
    const priceId = process.env.STRIPE_PRICE_ID;
    const trialDays = trialDaysForUser(user);

    const sessionPayload = {
      mode: "subscription",
      success_url: `${getSuccessUrl(req)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: getCancelUrl(req),
      customer: customerId,
      client_reference_id: String(user.id),
      metadata: {
        user_id: String(user.id),
      },
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          user_id: String(user.id),
        },
      },
    };

    if (trialDays > 0) {
      sessionPayload.subscription_data.trial_period_days = trialDays;
    }

    if (priceId) {
      sessionPayload.line_items = [{ price: priceId, quantity: 1 }];
    } else {
      sessionPayload.line_items = [{
        quantity: 1,
        price_data: {
          currency: DEFAULT_CURRENCY,
          recurring: { interval: "month" },
          unit_amount: DEFAULT_PRICE_CENTS,
          product_data: {
            name: "Dex AI Monthly",
            description: "Dex AI assistant subscription",
          },
        },
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);
    await db.run(
      "UPDATE users SET stripe_checkout_session_id = ? WHERE id = ?",
      [session.id, user.id]
    );

    return res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    });
  } catch (err) {
    console.error("Stripe subscribe error:", err);
    const providerUnreachable =
      err?.type === "StripeConnectionError" ||
      err?.code === "ECONNREFUSED" ||
      err?.code === "EACCES";
    return res.status(500).json({
      error: providerUnreachable ? "payment_provider_unreachable" : "payment_failed",
      retryable: providerUnreachable,
      message: providerUnreachable
        ? "Dex could not reach Stripe to create checkout right now. Please try again in a moment."
        : (err.message || "Stripe checkout could not be created."),
    });
  }
}

// POST /api/payments/subscribe
router.post("/subscribe", requireUser, createCheckoutSession);

// POST /api/payments/checkout-session
router.post("/checkout-session", requireUser, createCheckoutSession);

// POST /api/payments/portal
router.post("/portal", requireUser, async (req, res) => {
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user?.stripe_customer_id) {
    return res.status(400).json({
      error: "no_billing_customer",
      message: "No Stripe customer record found for this user yet.",
    });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: process.env.STRIPE_PORTAL_RETURN_URL || getSuccessUrl(req),
    });
    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("Stripe portal error:", err);
    return res.status(500).json({
      error: "portal_failed",
      message: err.message || "Could not create Stripe billing portal session.",
    });
  }
});

// POST /api/payments/webhook
router.post("/webhook", async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).send("Stripe webhook secret is not configured.");
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).send("Missing Stripe signature.");
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getDb();
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = parseInt(session.client_reference_id || session.metadata?.user_id || "0", 10);
        const user = userId ? await db.get("SELECT * FROM users WHERE id = ?", [userId]) : null;
        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
        const paymentIntentId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
        const customerId = typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;

        if (user) {
          await db.run(
            `UPDATE users
                SET stripe_customer_id = COALESCE(?, stripe_customer_id),
                    stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                    stripe_checkout_session_id = ?
              WHERE id = ?`,
            [customerId, subscriptionId, session.id, user.id]
          );

          if (subscriptionId) {
            const stripe = getStripe();
            await syncUserSubscription(db, stripe, subscriptionId);
          }

          await upsertPaymentRecord(db, {
            userId: user.id,
            paymentIntentId,
            checkoutSessionId: session.id,
            subscriptionId,
            amountCents: session.amount_total || DEFAULT_PRICE_CENTS,
            currency: (session.currency || DEFAULT_CURRENCY).toUpperCase(),
            status: "completed",
            affiliateCode: user.referred_by || null,
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const stripe = getStripe();
        await syncUserSubscription(db, stripe, subscription.id);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
        if (customerId) {
          await db.run(
            `UPDATE users
                SET access_type = 'expired'
              WHERE stripe_customer_id = ?`,
            [customerId]
          );
        }
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
        const subscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;

        if (customerId && subscriptionId) {
          const stripe = getStripe();
          const result = await syncUserSubscription(db, stripe, subscriptionId);
          if (result?.user) {
            await upsertPaymentRecord(db, {
              userId: result.user.id,
              paymentIntentId: typeof invoice.payment_intent === "string"
                ? invoice.payment_intent
                : invoice.payment_intent?.id,
              checkoutSessionId: null,
              subscriptionId,
              amountCents: invoice.amount_paid || DEFAULT_PRICE_CENTS,
              currency: (invoice.currency || DEFAULT_CURRENCY).toUpperCase(),
              status: "completed",
              affiliateCode: result.user.referred_by || null,
            });
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return res.status(500).send("Webhook handler failed.");
  }

  return res.json({ received: true });
});

// GET /api/payments/status
router.get("/status", requireUser, async (req, res) => {
  const db = getDb();
  const user = await resolveBillingAccess(db, req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({
    access_type: user.access_type,
    trialDaysLeft: user.trialDaysLeft,
    sub_expires: user.sub_expires,
    stripe_customer_id: user.stripe_customer_id || null,
    stripe_subscription_id: user.stripe_subscription_id || null,
  });
});

export default router;

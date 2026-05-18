import { Router } from "express";
import Stripe from "stripe";
import { requireUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { sendSubscriptionConfirmation } from "../services/email.js";

const router = Router();
const DEFAULT_PRICE_CENTS = parseInt(process.env.DEX_PRICE_CENTS || "999", 10);
const DEFAULT_CURRENCY = (process.env.DEX_CURRENCY || "usd").toLowerCase();
const COIN_PACKS = {
  starter: { coins: 100, amountCents: 199, name: "100 Dex Coins" },
  popular: { coins: 300, amountCents: 499, name: "300 Dex Coins" },
  mega: { coins: 750, amountCents: 999, name: "750 Dex Coins" },
};
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
  const secretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secretKey) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY.");
  }
  if (!secretKey.startsWith("sk_live_") && !secretKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must start with sk_live_ or sk_test_. Do not use a pk_ publishable key here.");
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

function getShopReturnUrl(req, status) {
  const siteUrl = process.env.PUBLIC_SITE_URL || getSiteUrl(req);
  return `${siteUrl.replace(/\/+$/, "")}/shop?checkout=${encodeURIComponent(status)}`;
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

async function ensureMemoryTable(db) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY(user_id, key)
    )`
  );
}

async function addDexCoins(db, userId, amount) {
  await ensureMemoryTable(db);
  const row = await db.get("SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_coins'", [userId]);
  const current = parseInt(row?.value || "0", 10) || 0;
  const next = current + amount;
  await db.run(
    `INSERT INTO user_memory (user_id, key, value) VALUES (?, 'dex_coins', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    [userId, String(next)]
  );
  return next;
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

async function hasCompletedCheckoutSession(db, checkoutSessionId) {
  if (!checkoutSessionId) return false;
  const existing = await db.get(
    "SELECT id FROM payments WHERE stripe_checkout_session_id = ? AND status = 'completed' LIMIT 1",
    [checkoutSessionId]
  );
  return Boolean(existing);
}

async function createCheckoutSession(req, res) {
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(stripe, db, user);
    const priceId = (process.env.STRIPE_PRICE_ID || "").trim();
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
      publishableKey: (process.env.STRIPE_PUBLISHABLE_KEY || "").trim() || null,
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

router.post("/coins-checkout", requireUser, async (req, res) => {
  const packId = String(req.body?.packId || "starter");
  const pack = COIN_PACKS[packId];
  if (!pack) return res.status(400).json({ error: "invalid_coin_pack", message: "Unknown Dex coin pack." });

  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(stripe, db, user);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${getSuccessUrl(req)}&coins=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: getCancelUrl(req),
      customer: customerId,
      client_reference_id: String(user.id),
      metadata: {
        purpose: "dex_coin_pack",
        user_id: String(user.id),
        pack_id: packId,
        coins: String(pack.coins),
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: DEFAULT_CURRENCY,
          unit_amount: pack.amountCents,
          product_data: {
            name: pack.name,
            description: "Coins for Dex accessories",
          },
        },
      }],
    });
    return res.json({ success: true, checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe coin checkout error:", err);
    return res.status(500).json({ error: "coin_checkout_failed", message: err.message || "Could not open coin checkout." });
  }
});

router.get("/products", async (req, res) => {
  const db = getDb();
  const products = await db.all(
    `SELECT id, name, description, category, price_cents, quantity, image_url
       FROM inventory
      WHERE quantity > 0
      ORDER BY category ASC, name ASC`
  );
  return res.json({ products });
});

router.post("/products/:id/checkout", requireUser, async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const quantity = Math.max(1, Math.min(10, parseInt(req.body?.quantity || "1", 10) || 1));
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  const product = await db.get(
    `SELECT id, name, description, category, price_cents, quantity, image_url
       FROM inventory
      WHERE id = ?`,
    [productId]
  );
  if (!product) return res.status(404).json({ error: "product_not_found", message: "That item is no longer available." });
  if (product.quantity < quantity) {
    return res.status(400).json({ error: "not_enough_stock", message: `Only ${product.quantity} left in stock.` });
  }
  if (product.price_cents <= 0) {
    return res.status(400).json({ error: "invalid_product_price", message: "This item needs a price before checkout." });
  }

  try {
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(stripe, db, user);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${getShopReturnUrl(req, "success")}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: getShopReturnUrl(req, "cancelled"),
      customer: customerId,
      client_reference_id: String(user.id),
      metadata: {
        purpose: "inventory_purchase",
        user_id: String(user.id),
        product_id: String(product.id),
        quantity: String(quantity),
      },
      line_items: [{
        quantity,
        price_data: {
          currency: DEFAULT_CURRENCY,
          unit_amount: product.price_cents,
          product_data: {
            name: product.name,
            description: product.description || product.category || "Konvict Artz product",
            ...(product.image_url ? { images: [product.image_url] } : {}),
          },
        },
      }],
    });
    return res.json({ success: true, checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe product checkout error:", err);
    return res.status(500).json({ error: "product_checkout_failed", message: err.message || "Could not open checkout." });
  }
});

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
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
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
        if (session.metadata?.purpose === "dex_coin_pack" && user) {
          const coins = parseInt(session.metadata.coins || "0", 10) || 0;
          if (coins > 0) await addDexCoins(db, user.id, coins);
          await upsertPaymentRecord(db, {
            userId: user.id,
            paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
            checkoutSessionId: session.id,
            subscriptionId: null,
            amountCents: session.amount_total || 0,
            currency: (session.currency || DEFAULT_CURRENCY).toUpperCase(),
            status: "completed",
            affiliateCode: user.referred_by || null,
          });
          break;
        }
        if (session.metadata?.purpose === "inventory_purchase" && user) {
          const productId = parseInt(session.metadata.product_id || "0", 10);
          const quantity = Math.max(1, parseInt(session.metadata.quantity || "1", 10) || 1);
          const alreadyCompleted = await hasCompletedCheckoutSession(db, session.id);
          if (!alreadyCompleted && productId) {
            await db.run(
              `UPDATE inventory
                  SET quantity = MAX(quantity - ?, 0),
                      updated_at = datetime('now'),
                      alerted = 0
                WHERE id = ?`,
              [quantity, productId]
            );
          }
          await upsertPaymentRecord(db, {
            userId: user.id,
            paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
            checkoutSessionId: session.id,
            subscriptionId: null,
            amountCents: session.amount_total || 0,
            currency: (session.currency || DEFAULT_CURRENCY).toUpperCase(),
            status: "completed",
            affiliateCode: user.referred_by || null,
          });
          break;
        }
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

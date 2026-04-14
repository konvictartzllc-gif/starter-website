import { Router } from "express";
import { Client, Environment } from "square";
import { requireUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { sendSubscriptionConfirmation } from "../services/email.js";

const router = Router();

function getSquareClient() {
  return new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENV === "production" ? Environment.Production : Environment.Sandbox,
  });
}

// POST /api/payments/subscribe — charge $9.99/month
router.post("/subscribe", requireUser, async (req, res) => {
  const { sourceId } = req.body; // nonce from Square Web Payments SDK
  if (!sourceId) return res.status(400).json({ error: "Payment source required" });

  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const square = getSquareClient();

    // Create or retrieve Square customer
    let customerId = user.square_customer_id;
    if (!customerId) {
      const { result: custResult } = await square.customersApi.createCustomer({
        emailAddress: user.email,
        givenName: user.name || user.email,
        idempotencyKey: `cust-${user.id}-${Date.now()}`,
      });
      customerId = custResult.customer.id;
      await db.run("UPDATE users SET square_customer_id = ? WHERE id = ?", [customerId, user.id]);
    }

    // Process payment of $9.99
    const amountCents = parseInt(process.env.DEX_PRICE_CENTS || "999", 10);
    const { result: payResult } = await square.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `pay-${user.id}-${Date.now()}`,
      amountMoney: { amount: BigInt(amountCents), currency: process.env.DEX_CURRENCY || "USD" },
      customerId,
      note: "Dex AI Monthly Subscription - Konvict Artz",
    });

    const paymentId = payResult.payment.id;

    // Set subscription expiry 30 days from now
    const subExpires = new Date();
    subExpires.setDate(subExpires.getDate() + 30);

    await db.run(
      `UPDATE users SET access_type = 'paid', sub_expires = ?, square_subscription_id = ? WHERE id = ?`,
      [subExpires.toISOString(), paymentId, user.id]
    );

    // Record payment
    await db.run(
      `INSERT INTO payments (user_id, square_payment_id, amount_cents, currency, status, affiliate_code)
       VALUES (?, ?, ?, ?, 'completed', ?)`,
      [user.id, paymentId, amountCents, "USD", user.referred_by || null]
    );

    // Credit affiliate $2 if applicable
    if (user.referred_by) {
      await db.run(
        `UPDATE affiliates SET paid_subs = paid_subs + 1, earnings = earnings + 2.0
         WHERE promo_code = ?`,
        [user.referred_by]
      );
    }

    await sendSubscriptionConfirmation(user.email, user.name);

    return res.json({ success: true, expires: subExpires.toISOString() });
  } catch (err) {
    console.error("Payment error:", err);
    return res.status(500).json({ error: "Payment failed", details: err.message });
  }
});

// GET /api/payments/status — check subscription status
router.get("/status", requireUser, async (req, res) => {
  const db = getDb();
  const user = await db.get(
    "SELECT access_type, trial_start, sub_expires FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: "User not found" });

  let access_type = user.access_type;
  let trialDaysLeft = null;

  if (access_type === "trial" && user.trial_start) {
    const trialEnd = new Date(user.trial_start);
    trialEnd.setDate(trialEnd.getDate() + 3);
    const now = new Date();
    if (now > trialEnd) {
      access_type = "expired";
      await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [req.user.id]);
    } else {
      trialDaysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    }
  }

  return res.json({ access_type, trialDaysLeft, sub_expires: user.sub_expires });
});

export default router;

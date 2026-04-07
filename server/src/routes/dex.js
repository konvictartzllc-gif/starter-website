import { randomUUID } from "crypto";
import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { Client, Environment } from "square";
import { requireAdmin, requireUser } from "../middleware/auth.js";

const router = Router();

async function generateReferralCode(db, username) {
  const base = username.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "DEX";
  for (let i = 0; i < 20; i += 1) {
    const code = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const existing = await db.get("SELECT id FROM users WHERE referral_code = ?", code);
    if (!existing) {
      return code;
    }
  }

  return `${base}${Date.now().toString().slice(-6)}`;
}

function getSquareClient() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    return null;
  }

  const env = String(process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? Environment.Production
    : Environment.Sandbox;

  return new Client({ accessToken, environment: env });
}

router.post(
  "/create-promoter",
  requireAdmin,
  [body("email").isEmail().normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const db = req.app.locals.db;
    const email = req.body.email.toLowerCase();
    const user = await db.get(
      "SELECT id, username, referral_code FROM users WHERE email = ? COLLATE NOCASE",
      email,
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const referralCode = user.referral_code || (await generateReferralCode(db, user.username));

    await db.run(
      "UPDATE users SET referral_code = ?, is_promoter = 1, free_access = 1 WHERE id = ?",
      referralCode,
      user.id,
    );

    const appBase = process.env.CLIENT_ORIGIN || "http://localhost:4000";
    return res.json({
      referralCode,
      link: `${appBase}/?ref=${referralCode}`,
    });
  },
);

router.get(
  "/stats/:code",
  [param("code").isString().trim().isLength({ min: 3, max: 64 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const db = req.app.locals.db;
    const row = await db.get(
      "SELECT referrals_count, free_access FROM users WHERE referral_code = ? COLLATE NOCASE",
      req.params.code,
    );

    if (!row) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({
      referrals: row.referrals_count,
      freeAccess: Boolean(row.free_access),
    });
  },
);

router.post("/access-ai", requireUser, async (req, res) => {
  const db = req.app.locals.db;
  const user = await db.get(
    "SELECT free_access, paid FROM users WHERE id = ?",
    req.user.sub,
  );

  if (!user) {
    return res.status(404).json({ error: "No user" });
  }

  const hasAccess = Boolean(user.free_access) || Boolean(user.paid);
  return res.status(hasAccess ? 200 : 403).json({ access: hasAccess });
});

router.post(
  "/pay",
  requireUser,
  [body("sourceId").isString().trim().isLength({ min: 10 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const squareClient = getSquareClient();
    const locationId = process.env.SQUARE_LOCATION_ID;

    if (!squareClient || !locationId) {
      return res.status(503).json({
        error: "Square payment is not configured",
      });
    }

    const db = req.app.locals.db;
    const user = await db.get("SELECT id, paid FROM users WHERE id = ?", req.user.sub);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.paid) {
      return res.json({ success: true, alreadyPaid: true });
    }

    const amountCents = Number(process.env.DEX_PRICE_CENTS || 1000);
    const currency = process.env.DEX_CURRENCY || "USD";
    const idempotencyKey = randomUUID();

    try {
      const payment = await squareClient.paymentsApi.createPayment({
        sourceId: req.body.sourceId,
        idempotencyKey,
        amountMoney: {
          amount: amountCents,
          currency,
        },
        locationId,
      });

      const squarePaymentId = payment?.result?.payment?.id || payment?.payment?.id || null;
      const status = payment?.result?.payment?.status || payment?.payment?.status || "COMPLETED";

      await db.run("UPDATE users SET paid = 1 WHERE id = ?", user.id);
      await db.run(
        "INSERT INTO payments (user_id, square_payment_id, amount_cents, currency, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)",
        user.id,
        squarePaymentId,
        amountCents,
        currency,
        status,
        idempotencyKey,
      );

      return res.json({ success: true, paymentId: squarePaymentId, status });
    } catch (err) {
      return res.status(502).json({ error: err.message || "Payment failed" });
    }
  },
);

export default router;

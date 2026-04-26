import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import { getDb } from "../db.js";
import { sendWelcomeEmail } from "../services/email.js";
import { requireUser } from "../middleware/auth.js";
import { generateOta } from "../middleware/security.js";

const router = Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}
// POST /api/auth/register
router.post(
  "/register",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
    body("name").optional().trim(),
    body("promoCode").optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name, promoCode } = req.body;
    const db = getDb();

    try {
      const existing = await db.get("SELECT id FROM users WHERE email = ?", [email]);
      if (existing) return res.status(409).json({ error: "Email already registered" });
      // Validate promo code if provided
      let referredBy = null;
      if (promoCode) {
        const aff = await db.get("SELECT id, user_id FROM affiliates WHERE promo_code = ?", [promoCode.toUpperCase()]);
        if (aff) {
          referredBy = promoCode.toUpperCase();
        }
      }
      const hashed = await bcrypt.hash(password, 12);
      const trialStart = new Date().toISOString();
      const result = await db.run(
        `INSERT INTO users (email, name, password, role, access_type, trial_start, referred_by)
         VALUES (?, ?, ?, 'user', 'trial', ?, ?)`,
        [email, name || null, hashed, trialStart, referredBy]
      );
      const user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
      await sendWelcomeEmail(email, name);

      return res.json({ token: signToken(user), user: { id: user.id, email, name, role: user.role, access_type: user.access_type } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// POST /api/auth/login
router.post(
  "/login",
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const db = getDb();

    try {
      const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });

      // Check trial expiry
      let access_type = user.access_type;
      if (access_type === "trial" && user.trial_start) {
        const trialEnd = new Date(user.trial_start);
        trialEnd.setDate(trialEnd.getDate() + 3);
        if (new Date() > trialEnd) {
          access_type = "expired";
          await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [user.id]);
        }
      }
      return res.json({
        token: signToken({ ...user, access_type }),
        user: { id: user.id, email: user.email, name: user.name, role: user.role, access_type },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// -- Update Phone --
router.put("/phone", requireUser, [body("phone").notEmpty().trim()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { phone } = req.body;
  const db = getDb();
  await db.run("UPDATE users SET phone = ? WHERE id = ?", [phone, req.user.id]);
  res.json({ success: true, message: "Phone number updated" });
});

// -- Request OTA Code --
router.post("/ota/request", requireUser, [body("actionType").notEmpty()], async (req, res) => {
  const { actionType } = req.body;
  try {
    await generateOta(req.user.id, actionType);
    res.json({ success: true, message: "Authorization code sent via SMS" });
  } catch (err) {
    res.status(500).json({ error: "Failed to send authorization code" });
  }
});

export default router;

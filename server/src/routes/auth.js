import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { body, validationResult } from "express-validator";

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

router.post(
  "/login",
  [
    body("username").isString().trim().notEmpty(),
    body("password").isString().isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;
    const db = req.app.locals.db;

    const admin = await db.get(
      "SELECT id, username, password_hash FROM admins WHERE username = ? COLLATE NOCASE",
      username,
    );

    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: admin.id, username: admin.username, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({ token });
  },
);

router.post(
  "/user/register",
  [
    body("username").isString().trim().isLength({ min: 2, max: 50 }),
    body("email").isEmail().normalizeEmail(),
    body("password").isString().isLength({ min: 8 }),
    body("ref").optional({ checkFalsy: true }).isString().trim().isLength({ min: 3, max: 64 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, ref } = req.body;
    const db = req.app.locals.db;

    const existing = await db.get(
      "SELECT id FROM users WHERE email = ? COLLATE NOCASE",
      email,
    );
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const referralCode = await generateReferralCode(db, username);
    const referredBy = ref ? ref.trim() : null;

    // Calculate trial period: 3 days from now
    const trialStartedAt = new Date().toISOString();
    const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const result = await db.run(
      "INSERT INTO users (email, username, password_hash, referral_code, referred_by, trial_started_at, trial_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      email.toLowerCase(),
      username,
      password_hash,
      referralCode,
      referredBy,
      trialStartedAt,
      trialExpiresAt,
    );

    if (referredBy) {
      const promoter = await db.get(
        "SELECT id FROM users WHERE referral_code = ? COLLATE NOCASE",
        referredBy,
      );

      if (promoter) {
        await db.run(
          "UPDATE users SET referrals_count = referrals_count + 1 WHERE id = ?",
          promoter.id,
        );
      }
    }

    const token = jwt.sign(
      {
        sub: result.lastID,
        username,
        email: email.toLowerCase(),
        role: "user",
        referralCode,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.status(201).json({ token });
  },
);

router.post(
  "/user/login",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isString().isLength({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const db = req.app.locals.db;

    const user = await db.get(
      "SELECT id, username, email, password_hash FROM users WHERE email = ? COLLATE NOCASE",
      email,
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, email: user.email, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({ token });
  },
);

export default router;

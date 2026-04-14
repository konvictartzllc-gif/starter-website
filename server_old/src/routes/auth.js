import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
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
    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;

    if (
      username !== envUser ||
      password !== envPass
    ) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: username, username, role: "admin" },
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
    const referredBy = ref ? ref.trim() : null;

    // Calculate trial period: 3 days from now
    const trialStartedAt = new Date().toISOString();
    const trialExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const result = await db.run(
      "INSERT INTO users (email, username, password_hash, referred_by, trial_started_at, trial_expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      email.toLowerCase(),
      username,
      password_hash,
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

router.post(
  "/user/login-with-code",
  [body("code").isString().trim().isLength({ min: 4, max: 32 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const code = req.body.code.trim().toUpperCase();
    const db = req.app.locals.db;

    const accessCode = await db.get(
      "SELECT id, used, assigned_email FROM access_codes WHERE code = ? COLLATE NOCASE",
      code,
    );

    if (!accessCode) {
      return res.status(404).json({ error: "Invalid access code. Please check and try again." });
    }
    if (accessCode.used) {
      return res.status(409).json({ error: "This code has already been used and is no longer valid." });
    }
    if (!accessCode.assigned_email) {
      return res.status(400).json({ error: "This code is not assigned to a promoter email." });
    }

    const assignedEmail = String(accessCode.assigned_email).toLowerCase();
    let user = await db.get(
      "SELECT id, username, email, referral_code FROM users WHERE email = ? COLLATE NOCASE",
      assignedEmail,
    );

    if (!user) {
      const emailBase = assignedEmail.split("@")[0] || "promoter";
      const username = `${emailBase.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) || "promoter"}${Math.floor(100 + Math.random() * 900)}`;
      const passwordHash = await bcrypt.hash(randomUUID(), 12);
      const referralCode = await generateReferralCode(db, username);
      const created = await db.run(
        "INSERT INTO users (email, username, password_hash, referral_code, free_access, is_promoter) VALUES (?, ?, ?, ?, 1, 1)",
        assignedEmail,
        username,
        passwordHash,
        referralCode,
      );
      user = await db.get(
        "SELECT id, username, email, referral_code FROM users WHERE id = ?",
        created.lastID,
      );
    } else {
      let referralCode = user.referral_code;
      if (!referralCode) {
        referralCode = await generateReferralCode(db, user.username);
      }

      await db.run(
        "UPDATE users SET is_promoter = 1, free_access = 1, referral_code = ? WHERE id = ?",
        referralCode,
        user.id,
      );

      user = {
        ...user,
        referral_code: referralCode,
      };
    }

    await db.run(
      "UPDATE access_codes SET used = 1, used_by_user_id = ?, used_at = ? WHERE id = ?",
      user.id,
      new Date().toISOString(),
      accessCode.id,
    );

    const token = jwt.sign(
      { sub: user.id, username: user.username, email: user.email, role: "user", referralCode: user.referral_code },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({ token, promoter: true, referralCode: user.referral_code });
  },
);

router.post(
  "/user/redeem-code",
  [
    body("code").isString().trim().isLength({ min: 4, max: 32 }),
    body("username").isString().trim().isLength({ min: 2, max: 50 }),
    body("email").isEmail().normalizeEmail(),
    body("password").isString().isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { code, username, email, password } = req.body;
    const db = req.app.locals.db;

    const accessCode = await db.get(
      "SELECT id, used FROM access_codes WHERE code = ? COLLATE NOCASE",
      code.trim().toUpperCase(),
    );

    if (!accessCode) {
      return res.status(404).json({ error: "Invalid access code. Please check and try again." });
    }
    if (accessCode.used) {
      return res.status(409).json({ error: "This code has already been used and is no longer valid." });
    }

    const existing = await db.get(
      "SELECT id FROM users WHERE email = ? COLLATE NOCASE",
      email,
    );
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists. Please log in instead." });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const referralCode = await generateReferralCode(db, username);

    const result = await db.run(
      "INSERT INTO users (email, username, password_hash, referral_code, free_access, is_promoter) VALUES (?, ?, ?, ?, 1, 1)",
      email.toLowerCase(),
      username,
      password_hash,
      referralCode,
    );

    await db.run(
      "UPDATE access_codes SET used = 1, used_by_user_id = ?, used_at = ? WHERE id = ?",
      result.lastID,
      new Date().toISOString(),
      accessCode.id,
    );

    const token = jwt.sign(
      { sub: result.lastID, username, email: email.toLowerCase(), role: "user", referralCode },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.status(201).json({ token, lifetimeAccess: true });
  },
);

export default router;

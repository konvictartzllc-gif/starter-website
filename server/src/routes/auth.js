import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import { getDb } from "../db.js";
import { getJwtSecret } from "../config.js";
import { sendWelcomeEmail } from "../services/email.js";
import { ensureAffiliateRecord } from "../services/affiliates.js";
import { requireUser } from "../middleware/auth.js";
import { generateOta } from "../middleware/security.js";

const router = Router();

function fireAndForget(label, task) {
  Promise.resolve()
    .then(task)
    .catch((err) => {
      console.error(`${label} failed:`, err?.message || err);
    });
}

function createAuthConfigError(message) {
  const error = new Error(message);
  error.code = "AUTH_CONFIG_ERROR";
  return error;
}

function signToken(user) {
  const secret = getJwtSecret();
  if (!secret) {
    throw createAuthConfigError("JWT_SECRET is missing.");
  }
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    secret,
    { expiresIn: "7d" }
  );
}

function sendAuthFailure(res, context, err, details = {}) {
  console.error(`[auth:${context}]`, {
    message: err?.message || "Unknown auth error",
    code: err?.code || null,
    details,
    stack: err?.stack || null,
  });

  if (err?.code === "AUTH_CONFIG_ERROR") {
    return res.status(500).json({ error: "Authentication service is not configured correctly." });
  }

  if (typeof err?.message === "string" && err.message.toLowerCase().includes("invalid salt")) {
    return res.status(500).json({ error: "This account password is stored incorrectly. Reset or recreate the account." });
  }

  if (err?.statusCode && err?.message) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  return res.status(500).json({ error: "Server error" });
}

async function consumeAffiliateInviteCode(db, inviteCode, email, userId) {
  if (!inviteCode) return null;
  const normalized = String(inviteCode).trim().toUpperCase();
  if (!normalized) return null;

  const invite = await db.get(
    "SELECT * FROM affiliate_invite_codes WHERE UPPER(code) = ?",
    [normalized]
  );
  if (!invite) return null;
  if (invite.used) {
    const error = new Error("That affiliate invite code has already been used.");
    error.statusCode = 409;
    throw error;
  }
  if (invite.email && invite.email.toLowerCase() !== String(email).trim().toLowerCase()) {
    const error = new Error("That affiliate invite code is assigned to a different email address.");
    error.statusCode = 403;
    throw error;
  }

  await db.run(
    `UPDATE affiliate_invite_codes
        SET used = 1,
            claimed_by = ?,
            used_at = datetime('now')
      WHERE id = ?`,
    [userId, invite.id]
  );

  return invite;
}

async function resolveUserAccess(db, user) {
  if (!user) return null;
  if (user.role === "admin" || user.access_type === "unlimited") {
    return { ...user, access_type: "unlimited", trialDaysLeft: null };
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
    await db.run("UPDATE users SET access_type = ? WHERE id = ?", [accessType, user.id]);
  }

  return { ...user, access_type: accessType, trialDaysLeft };
}

// POST /api/auth/register
router.post(
  "/register",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
    body("name").optional().trim(),
    body("promoCode").optional().trim(),
    body("affiliateInviteCode").optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name, promoCode, affiliateInviteCode } = req.body;
    const db = getDb();

    try {
      const existing = await db.get("SELECT * FROM users WHERE email = ?", [email]);
      if (existing) {
        const canClaimInvitedAffiliate = existing.role === "affiliate" && !existing.password;

        if (!canClaimInvitedAffiliate) {
          return res.status(409).json({ error: "Email already registered" });
        }

        const hashed = await bcrypt.hash(password, 12);
        await db.run(
          `UPDATE users
              SET password = ?,
                  name = COALESCE(NULLIF(?, ''), name),
                  access_type = 'unlimited'
            WHERE id = ?`,
          [hashed, name || null, existing.id]
        );

        const invitedAffiliate = await db.get("SELECT * FROM users WHERE id = ?", [existing.id]);
        const resolvedAffiliate = await resolveUserAccess(db, invitedAffiliate);
        return res.json({
          token: signToken(resolvedAffiliate),
          user: {
            id: resolvedAffiliate.id,
            email: resolvedAffiliate.email,
            name: resolvedAffiliate.name,
            role: resolvedAffiliate.role,
            access_type: resolvedAffiliate.access_type,
          },
        });
      }

      let referredBy = null;
      const requestedAffiliateInvite = String(affiliateInviteCode || "").trim();
      const requestedPromoCode = String(promoCode || "").trim();
      const isAffiliateInviteSignup = requestedAffiliateInvite.length > 0;

      if (requestedPromoCode) {
        const aff = await db.get("SELECT id, user_id FROM affiliates WHERE promo_code = ?", [promoCode.toUpperCase()]);
        if (aff) {
          referredBy = promoCode.toUpperCase();
        }
      }

      const hashed = await bcrypt.hash(password, 12);
      const trialStart = new Date().toISOString();
      const result = await db.run(
        `INSERT INTO users (email, name, password, role, access_type, trial_start, referred_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          email,
          name || null,
          hashed,
          isAffiliateInviteSignup ? "affiliate" : "user",
          isAffiliateInviteSignup ? "unlimited" : "trial",
          isAffiliateInviteSignup ? null : trialStart,
          referredBy,
        ]
      );
      const user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
      if (isAffiliateInviteSignup) {
        await consumeAffiliateInviteCode(db, requestedAffiliateInvite, email, user.id);
        await ensureAffiliateRecord(db, user.id);
      }
      const resolvedUser = await resolveUserAccess(db, user);

      if (referredBy) {
        await db.run(
          `UPDATE affiliates
              SET signups = signups + 1
            WHERE promo_code = ?`,
          [referredBy]
        );
      }

      fireAndForget("Welcome email", () => sendWelcomeEmail(email, name));

      return res.json({
        token: signToken(resolvedUser),
        user: {
          id: resolvedUser.id,
          email: resolvedUser.email,
          name: resolvedUser.name,
          role: resolvedUser.role,
          access_type: resolvedUser.access_type,
          trialDaysLeft: resolvedUser.trialDaysLeft,
        },
      });
    } catch (err) {
      return sendAuthFailure(res, "register", err, { email });
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
      if (!user.password) return res.status(401).json({ error: "Invalid credentials" });

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });

      const resolvedUser = await resolveUserAccess(db, user);
      return res.json({
        token: signToken(resolvedUser),
        user: {
          id: resolvedUser.id,
          email: resolvedUser.email,
          name: resolvedUser.name,
          role: resolvedUser.role,
          access_type: resolvedUser.access_type,
          trialDaysLeft: resolvedUser.trialDaysLeft,
        },
      });
    } catch (err) {
      return sendAuthFailure(res, "login", err, { email });
    }
  }
);

router.get("/me", requireUser, async (req, res) => {
  const db = getDb();
  const user = await db.get(
    "SELECT id, email, name, role, access_type, trial_start, sub_expires FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: "User not found" });

  const resolvedUser = await resolveUserAccess(db, user);
  return res.json({
    user: {
      id: resolvedUser.id,
      email: resolvedUser.email,
      name: resolvedUser.name,
      role: resolvedUser.role,
      access_type: resolvedUser.access_type,
      trialDaysLeft: resolvedUser.trialDaysLeft,
      sub_expires: resolvedUser.sub_expires || null,
    },
  });
});

router.put("/phone", requireUser, [body("phone").notEmpty().trim()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { phone } = req.body;
  const db = getDb();
  await db.run("UPDATE users SET phone = ? WHERE id = ?", [phone, req.user.id]);
  res.json({ success: true, message: "Phone number updated" });
});

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

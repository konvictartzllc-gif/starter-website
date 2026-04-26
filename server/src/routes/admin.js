import { Router } from "express";
import { body, validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import { requireAdmin } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { sendPromoterNotification, sendPromoCode } from "../services/email.js";
import { sendLowInventoryAlert } from "../services/ringcentral.js";

const router = Router();

function getReferralLink(promoCode) {
  return `${process.env.CLIENT_ORIGIN || "https://www.konvict-artz.com"}?ref=${promoCode}`;
}

async function ensureFeatureFlagsTable(db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await db.run(`
    INSERT INTO feature_flags (key, enabled, description)
    VALUES
      ('relationship_aliases', 1, 'Let users map relationship shortcuts like wife or boss to saved contacts.'),
      ('morning_briefing', 1, 'Enable Dex morning briefing summaries and planning suggestions.'),
      ('action_center', 1, 'Enable Dex action center for tasks and follow-up suggestions.'),
      ('learning_reminders', 1, 'Enable Dex daily learning reminder scheduling.')
    ON CONFLICT(key) DO NOTHING;
  `);
}

async function ensureAffiliateRecord(db, userId) {
  const existing = await db.get("SELECT * FROM affiliates WHERE user_id = ?", [userId]);
  if (existing) return existing;

  const promoCode = `DEX${uuidv4().slice(0, 6).toUpperCase()}`;
  await db.run(
    "INSERT INTO affiliates (user_id, promo_code) VALUES (?, ?)",
    [userId, promoCode]
  );
  return db.get("SELECT * FROM affiliates WHERE user_id = ?", [userId]);
}

router.get("/stats", requireAdmin, async (req, res) => {
  const db = getDb();
  await ensureFeatureFlagsTable(db);
  const totalUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
  const paidUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE access_type = 'paid'");
  const trialUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE access_type = 'trial'");
  const totalRevenue = await db.get("SELECT SUM(amount_cents) as total FROM payments WHERE status = 'completed'");
  const affiliateCount = await db.get("SELECT COUNT(*) as count FROM affiliates");
  const lowInventory = await db.all("SELECT * FROM inventory WHERE quantity <= low_threshold ORDER BY quantity ASC");
  const activeToday = await db.get(`
    SELECT COUNT(DISTINCT user_id) as count
      FROM (
        SELECT user_id FROM chat_history WHERE created_at >= datetime('now', '-1 day')
        UNION ALL
        SELECT user_id FROM call_events WHERE created_at >= datetime('now', '-1 day')
      )
  `);
  const openTasks = await db.get("SELECT COUNT(*) as count FROM task_items WHERE status != 'done'");
  const savedAliases = await db.get("SELECT COUNT(*) as count FROM relationship_aliases");
  const learningLessons = await db.get("SELECT COUNT(*) as count FROM learning_lessons");
  const featureFlags = await db.all("SELECT key, enabled, description, updated_at FROM feature_flags ORDER BY key ASC");

  return res.json({
    totalUsers: totalUsers.count,
    paidUsers: paidUsers.count,
    trialUsers: trialUsers.count,
    totalRevenueCents: totalRevenue.total || 0,
    affiliateCount: affiliateCount.count,
    lowInventory,
    activeToday: activeToday.count,
    openTasks: openTasks.count,
    savedAliases: savedAliases.count,
    learningLessons: learningLessons.count,
    featureFlags,
  });
});

router.get("/feature-flags", requireAdmin, async (req, res) => {
  const db = getDb();
  await ensureFeatureFlagsTable(db);
  const flags = await db.all("SELECT key, enabled, description, updated_at FROM feature_flags ORDER BY key ASC");
  return res.json(flags);
});

router.patch("/feature-flags/:key", requireAdmin, async (req, res) => {
  const db = getDb();
  await ensureFeatureFlagsTable(db);
  const key = String(req.params.key || "").trim();
  const enabled = req.body.enabled ? 1 : 0;
  const current = await db.get("SELECT * FROM feature_flags WHERE key = ?", [key]);
  if (!current) return res.status(404).json({ error: "Feature flag not found" });
  await db.run(
    `UPDATE feature_flags
        SET enabled = ?,
            updated_at = datetime('now')
      WHERE key = ?`,
    [enabled, key]
  );
  const updated = await db.get("SELECT key, enabled, description, updated_at FROM feature_flags WHERE key = ?", [key]);
  return res.json({ success: true, flag: updated });
});

router.get("/inventory", requireAdmin, async (req, res) => {
  const db = getDb();
  const items = await db.all("SELECT * FROM inventory ORDER BY name ASC");
  return res.json(items);
});

router.post("/inventory", requireAdmin, [
  body("name").notEmpty().trim(),
  body("price_cents").isInt({ min: 0 }),
  body("quantity").isInt({ min: 0 }),
  body("low_threshold").optional().isInt({ min: 1 }),
  body("category").optional().trim(),
  body("description").optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, category, price_cents, quantity, low_threshold, image_url } = req.body;
  const db = getDb();
  const result = await db.run(
    `INSERT INTO inventory (name, description, category, price_cents, quantity, low_threshold, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, description || null, category || null, price_cents, quantity, low_threshold || 5, image_url || null]
  );
  const item = await db.get("SELECT * FROM inventory WHERE id = ?", [result.lastID]);
  return res.json(item);
});

router.put("/inventory/:id", requireAdmin, async (req, res) => {
  const { name, description, category, price_cents, quantity, low_threshold, image_url } = req.body;
  const db = getDb();
  await db.run(
    `UPDATE inventory
        SET name = ?,
            description = ?,
            category = ?,
            price_cents = ?,
            quantity = ?,
            low_threshold = ?,
            image_url = ?,
            updated_at = datetime('now'),
            alerted = 0
      WHERE id = ?`,
    [name, description, category, price_cents, quantity, low_threshold || 5, image_url, req.params.id]
  );
  const item = await db.get("SELECT * FROM inventory WHERE id = ?", [req.params.id]);
  return res.json(item);
});

router.delete("/inventory/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.run("DELETE FROM inventory WHERE id = ?", [req.params.id]);
  return res.json({ success: true });
});

router.get("/affiliates", requireAdmin, async (req, res) => {
  const db = getDb();
  const affiliates = await db.all(
    `SELECT a.*, u.email, u.name
       FROM affiliates a
       JOIN users u ON u.id = a.user_id
      ORDER BY a.paid_subs DESC, a.signups DESC`
  );
  return res.json(affiliates);
});

router.post("/affiliates/create", requireAdmin, [
  body("email").isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, name } = req.body;
  const db = getDb();

  try {
    let user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      const result = await db.run(
        `INSERT INTO users (email, name, role, access_type)
         VALUES (?, ?, 'affiliate', 'unlimited')`,
        [email, name || null]
      );
      user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    } else {
      await db.run(
        `UPDATE users
            SET role = 'affiliate',
                access_type = 'unlimited',
                name = COALESCE(NULLIF(?, ''), name)
          WHERE id = ?`,
        [name || null, user.id]
      );
      user = await db.get("SELECT * FROM users WHERE id = ?", [user.id]);
    }

    const affiliate = await ensureAffiliateRecord(db, user.id);
    const referralLink = getReferralLink(affiliate.promo_code);
    await sendPromoterNotification(user.email, user.name, affiliate.promo_code, referralLink);

    return res.json({
      success: true,
      promoCode: affiliate.promo_code,
      referralLink,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        access_type: user.access_type,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create affiliate" });
  }
});

router.post("/send-promo", requireAdmin, [
  body("email").isEmail().normalizeEmail(),
  body("code").notEmpty().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, name, code } = req.body;
  await sendPromoCode(email, name, code);
  return res.json({ success: true });
});

router.get("/users", requireAdmin, async (req, res) => {
  const db = getDb();
  const users = await db.all(
    `SELECT id, email, name, role, access_type, trial_start, sub_expires, created_at
       FROM users
      ORDER BY created_at DESC`
  );
  return res.json(users);
});

router.patch("/users/:id/access", requireAdmin, async (req, res) => {
  const db = getDb();
  const targetId = parseInt(req.params.id, 10);
  const { role, access_type } = req.body;

  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const allowedRoles = new Set(["user", "affiliate", "admin"]);
  const allowedAccessTypes = new Set(["none", "trial", "paid", "expired", "unlimited"]);

  if (role && !allowedRoles.has(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  if (access_type && !allowedAccessTypes.has(access_type)) {
    return res.status(400).json({ error: "Invalid access type" });
  }

  const current = await db.get("SELECT * FROM users WHERE id = ?", [targetId]);
  if (!current) return res.status(404).json({ error: "User not found" });

  const nextRole = role || current.role;
  const nextAccessType = access_type || current.access_type;

  await db.run(
    `UPDATE users
        SET role = ?,
            access_type = ?
      WHERE id = ?`,
    [nextRole, nextAccessType, targetId]
  );

  if (nextRole === "affiliate") {
    await ensureAffiliateRecord(db, targetId);
  }

  const updated = await db.get(
    `SELECT id, email, name, role, access_type, trial_start, sub_expires, created_at
       FROM users
      WHERE id = ?`,
    [targetId]
  );

  return res.json({ success: true, user: updated });
});

router.post("/check-inventory", requireAdmin, async (req, res) => {
  const db = getDb();
  const lowItems = await db.all(
    "SELECT * FROM inventory WHERE quantity <= low_threshold AND alerted = 0"
  );
  for (const item of lowItems) {
    await sendLowInventoryAlert(item.name, item.quantity);
    await db.run("UPDATE inventory SET alerted = 1 WHERE id = ?", [item.id]);
  }
  return res.json({ alerted: lowItems.map((i) => i.name) });
});

export default router;

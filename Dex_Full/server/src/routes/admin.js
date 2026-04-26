import { Router } from "express";
import { body, validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import { requireAdmin } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { sendPromoterNotification, sendPromoCode } from "../services/email.js";
import { sendLowInventoryAlert } from "../services/ringcentral.js";

const router = Router();

// -- Dashboard Stats --
router.get("/stats", requireAdmin, async (req, res) => {
  const db = getDb();
  const totalUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'user'");
  const paidUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE access_type = 'paid'");
  const trialUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE access_type = 'trial'");
  const totalRevenue = await db.get("SELECT SUM(amount_cents) as total FROM payments WHERE status = 'completed'");
  const affiliateCount = await db.get("SELECT COUNT(*) as count FROM affiliates");
  const lowInventory = await db.all("SELECT * FROM inventory WHERE quantity <= low_threshold ORDER BY quantity ASC");

  return res.json({
    totalUsers: totalUsers.count,
    paidUsers: paidUsers.count,
    trialUsers: trialUsers.count,
    totalRevenueCents: totalRevenue.total || 0,
    affiliateCount: affiliateCount.count,
    lowInventory,
  });
});

// -- Inventory Management --
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
    `UPDATE inventory SET name=?, description=?, category=?, price_cents=?, quantity=?, low_threshold=?, image_url=?, updated_at=datetime('now'), alerted=0
     WHERE id=?`,
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

// -- Affiliate / Promoter Management --
router.get("/affiliates", requireAdmin, async (req, res) => {
  const db = getDb();
  const affiliates = await db.all(
    `SELECT a.*, u.email, u.name FROM affiliates a
     JOIN users u ON u.id = a.user_id
     ORDER BY a.paid_subs DESC`
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
      // Create affiliate user account (no password — they'll set it on first login)
      const result = await db.run(
        `INSERT INTO users (email, name, role, access_type) VALUES (?, ?, 'affiliate', 'unlimited')`,
        [email, name || null]
      );
      user = await db.get("SELECT * FROM users WHERE id = ?", [result.lastID]);
    } else {
      await db.run("UPDATE users SET role = 'affiliate', access_type = 'unlimited' WHERE id = ?", [user.id]);
    }

    // Generate unique promo code
    const promoCode = `DEX${uuidv4().slice(0, 6).toUpperCase()}`;
    await db.run(
      "INSERT INTO affiliates (user_id, promo_code) VALUES (?, ?)",
      [user.id, promoCode]
    );

    const referralLink = `${process.env.CLIENT_ORIGIN || "https://www.konvict-artz.com"}?ref=${promoCode}`;
    await sendPromoterNotification(email, name, promoCode, referralLink);

    return res.json({ success: true, promoCode, referralLink });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create affiliate" });
  }
});

// -- Send Promo Code to Anyone --
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

// -- Users List --
router.get("/users", requireAdmin, async (req, res) => {
  const db = getDb();
  const users = await db.all(
    `SELECT id, email, name, role, access_type, trial_start, sub_expires, created_at
     FROM users ORDER BY created_at DESC`
  );
  return res.json(users);
});

// -- Check & Alert Low Inventory --
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

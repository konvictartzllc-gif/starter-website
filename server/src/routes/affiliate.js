import { Router } from "express";
import { requireUser } from "../middleware/auth.js";
import { getDb } from "../db.js";

const router = Router();

// GET /api/affiliate/dashboard — affiliate's own stats
router.get("/dashboard", requireUser, async (req, res) => {
  const db = getDb();
  const aff = await db.get(
    `SELECT a.*, u.email, u.name FROM affiliates a
     JOIN users u ON u.id = a.user_id
     WHERE a.user_id = ?`,
    [req.user.id]
  );
  if (!aff) return res.status(404).json({ error: "Not an affiliate" });

  const referralLink = `${process.env.CLIENT_ORIGIN || "https://www.konvict-artz.com"}?ref=${aff.promo_code}`;
  const recentSignups = await db.all(
    `SELECT name, email, created_at FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 20`,
    [aff.promo_code]
  );

  return res.json({
    promoCode: aff.promo_code,
    referralLink,
    signups: aff.signups,
    paidSubs: aff.paid_subs,
    earnings: aff.earnings,
    recentSignups,
  });
});

export default router;

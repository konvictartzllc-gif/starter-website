import { Router } from "express";
import { requireUser } from "../middleware/auth.js";

const router = Router();

// GET /api/user/me — current user's profile
router.get("/me", requireUser, async (req, res) => {
  const db = req.app.locals.db;
  const user = await db.get(
    "SELECT id, username, email, referral_code, referred_by, is_promoter, free_access, referrals_count, paid, created_at FROM users WHERE id = ?",
    req.user.sub,
  );
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    referralCode: Boolean(user.is_promoter) ? user.referral_code : null,
    referredBy: user.referred_by,
    isPromoter: Boolean(user.is_promoter),
    freeAccess: Boolean(user.free_access),
    referralsCount: user.referrals_count,
    paid: Boolean(user.paid),
    created_at: user.created_at,
  });
});

// GET /api/user/bookings — bookings associated with this user's email
router.get("/bookings", requireUser, async (req, res) => {
  const db = req.app.locals.db;
  const bookings = await db.all(
    "SELECT id, name, service, booking_date, booking_time, notes, created_at FROM bookings WHERE email = ? COLLATE NOCASE ORDER BY created_at DESC",
    req.user.email,
  );
  return res.json(bookings);
});

export default router;

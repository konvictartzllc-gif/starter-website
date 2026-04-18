import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { sendAdEmail } from "../services/email.js";

const router = Router();

// POST /api/admin/send-ad-campaign
router.post("/send-ad-campaign", requireAdmin, async (req, res) => {
  const { subject, adId, target_location } = req.body;
  if (!subject || !adId || !target_location) return res.status(400).json({ error: "Missing required fields" });
  const db = getDb();
  const ad = await db.get("SELECT * FROM ads WHERE id = ? AND active = 1", [adId]);
  if (!ad) return res.status(404).json({ error: "Ad not found or inactive" });
  // Get all user emails in the target location
  const users = await db.all("SELECT email FROM users WHERE access_type != 'expired' AND (location = ? OR ? = 'ALL')", [target_location, target_location]);
  let sent = 0;
  for (const user of users) {
    await sendAdEmail(user.email, subject, ad);
    sent++;
  }
  res.json({ success: true, sent });
});

export default router;

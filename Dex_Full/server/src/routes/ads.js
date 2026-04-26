import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { getDb } from "../db.js";

const router = Router();

// POST /api/admin/ads - create or update an ad
router.post("/ads", requireAdmin, async (req, res) => {
  const { title, content, image, target_location, active } = req.body;
  if (!title || !content || !target_location) return res.status(400).json({ error: "Missing required fields" });
  const db = getDb();
  await db.run(
    `INSERT INTO ads (title, content, image, target_location, active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(title, target_location) DO UPDATE SET content = excluded.content, image = excluded.image, active = excluded.active`,
    [title, content, image || null, target_location, active ? 1 : 0]
  );
  res.json({ success: true });
});

// GET /api/ads?location=USA - get active ads for a location
router.get("/ads", async (req, res) => {
  const { location } = req.query;
  const db = getDb();
  const ads = await db.all(
    `SELECT * FROM ads WHERE active = 1 AND target_location = ?`,
    [location || "USA"]
  );
  res.json({ ads });
});

export default router;

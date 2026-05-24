import { Router } from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import { requireUser } from "../middleware/auth.js";
import { getDb } from "../db.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getAffiliateForUser(userId) {
  const db = getDb();
  return db.get(
    `SELECT a.*, u.email, u.name FROM affiliates a
     JOIN users u ON u.id = a.user_id
     WHERE a.user_id = ?`,
    [userId]
  );
}

function defaultApkPath() {
  return path.resolve(__dirname, "../../../android-app/app/build/outputs/apk/debug/app-debug.apk");
}

// GET /api/affiliate/dashboard — affiliate's own stats
router.get("/dashboard", requireUser, async (req, res) => {
  const db = getDb();
  const aff = await getAffiliateForUser(req.user.id);
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
    androidDownloadAvailable: Boolean(
      process.env.DEX_ANDROID_APK_URL ||
        process.env.DEX_ANDROID_APK_PATH ||
        fs.existsSync(defaultApkPath())
    ),
    recentSignups,
  });
});

router.get("/android/download", requireUser, async (req, res) => {
  const aff = await getAffiliateForUser(req.user.id);
  if (!aff) return res.status(404).json({ error: "Not an affiliate" });

  const apkUrl = process.env.DEX_ANDROID_APK_URL?.trim();
  if (apkUrl) {
    try {
      const upstream = await fetch(apkUrl);
      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ error: "Dex Android download could not be reached." });
      }
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="Dex-Assistant.apk"');
      return Readable.fromWeb(upstream.body).pipe(res);
    } catch {
      return res.status(502).json({ error: "Dex Android download could not be reached." });
    }
  }

  const apkPath = path.resolve(process.env.DEX_ANDROID_APK_PATH || defaultApkPath());
  fs.access(apkPath, fs.constants.R_OK, (err) => {
    if (err) {
      return res.status(503).json({
        error: "Dex Android download is not configured yet.",
        detail: "Set DEX_ANDROID_APK_URL or DEX_ANDROID_APK_PATH on the backend.",
      });
    }
    return res.download(apkPath, "Dex-Assistant.apk");
  });
});

export default router;

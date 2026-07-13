import { Router } from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import { requireUser } from "../middleware/auth.js";
import { getDb } from "../db.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAYOUT_METHODS = new Set(["paypal", "cash_app", "venmo", "zelle", "bank_transfer", "other"]);

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

async function getPendingPayoutTotal(db, affiliateId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM affiliate_payout_requests
      WHERE affiliate_id = ?
        AND status IN ('pending', 'approved', 'processing')`,
    [affiliateId]
  );
  return Number(row?.total || 0);
}

async function getRecentPayoutRequests(db, affiliateId) {
  return db.all(
    `SELECT id, amount, payout_method, status, notes, requested_at, updated_at
       FROM affiliate_payout_requests
      WHERE affiliate_id = ?
      ORDER BY requested_at DESC
      LIMIT 10`,
    [affiliateId]
  );
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
  const pendingPayouts = await getPendingPayoutTotal(db, aff.id);
  const availableToCashOut = Math.max(0, Number(aff.earnings || 0) - pendingPayouts);
  const payoutRequests = await getRecentPayoutRequests(db, aff.id);

  return res.json({
    promoCode: aff.promo_code,
    referralLink,
    signups: aff.signups,
    paidSubs: aff.paid_subs,
    earnings: Number(aff.earnings || 0),
    pendingPayouts,
    availableToCashOut,
    payoutRequests,
    androidDownloadAvailable: Boolean(
      process.env.DEX_ANDROID_APK_URL ||
        process.env.DEX_ANDROID_APK_PATH ||
        fs.existsSync(defaultApkPath())
    ),
    recentSignups,
  });
});

router.post("/cashout", requireUser, async (req, res) => {
  const db = getDb();
  const aff = await getAffiliateForUser(req.user.id);
  if (!aff) return res.status(404).json({ error: "Not an affiliate" });

  const amount = Number(req.body?.amount);
  const payoutMethod = String(req.body?.payoutMethod || "").trim();
  const payoutDetails = String(req.body?.payoutDetails || "").trim();
  const normalizedMethod = payoutMethod.toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid cash-out amount." });
  }
  if (!PAYOUT_METHODS.has(normalizedMethod)) {
    return res.status(400).json({ error: "Choose a valid payout method." });
  }
  if (payoutDetails.length < 3) {
    return res.status(400).json({ error: "Enter where this payout should be sent." });
  }

  const roundedAmount = Math.round(amount * 100) / 100;
  const pendingPayouts = await getPendingPayoutTotal(db, aff.id);
  const availableToCashOut = Math.max(0, Number(aff.earnings || 0) - pendingPayouts);

  if (roundedAmount > availableToCashOut) {
    return res.status(400).json({
      error: "That amount is more than your available affiliate earnings.",
      availableToCashOut,
    });
  }

  const result = await db.run(
    `INSERT INTO affiliate_payout_requests
       (affiliate_id, user_id, amount, payout_method, payout_details)
     VALUES (?, ?, ?, ?, ?)`,
    [aff.id, req.user.id, roundedAmount, normalizedMethod, payoutDetails]
  );
  const payoutRequest = await db.get(
    `SELECT id, amount, payout_method, status, notes, requested_at, updated_at
       FROM affiliate_payout_requests
      WHERE id = ?`,
    [result.lastID]
  );

  return res.status(201).json({
    success: true,
    payoutRequest,
    availableToCashOut: Math.max(0, availableToCashOut - roundedAmount),
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

import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { getEmailStatus, initEmail } from "./services/email.js";
import { getRingCentralStatus, initRingCentral } from "./services/ringcentral.js";
import { getAIStatus, initAI } from "./services/ai.js";
import authRoutes from "./routes/auth.js";
import dexRoutes from "./routes/dex.js";
import paymentsRoutes from "./routes/payments.js";
import adminRoutes from "./routes/admin.js";
import affiliateRoutes from "./routes/affiliate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
const defaultOrigins = [
  "https://starter-website-4dafg1xyq-konvict-artz.vercel.app",
  "https://starter-website-git-dex-v2-patches-konvict-artz.vercel.app",
  "https://www.konvict-artz.com",
  "https://konvict-artz.com",
  "https://konvictartz.com"
];
const configuredOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.PUBLIC_SITE_URL,
  ...(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...configuredOrigins]));

function boolSummary(value, missingReason) {
  return value
    ? { configured: true, reason: "ok" }
    : { configured: false, reason: missingReason };
}

function getStripeStatus() {
  const configured = Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PUBLISHABLE_KEY &&
    process.env.STRIPE_PRICE_ID &&
    process.env.STRIPE_WEBHOOK_SECRET
  );
  return {
    configured,
    ready: configured,
    reason: configured ? "ok" : "missing_config",
    checkoutUrls: {
      success: boolSummary(process.env.STRIPE_SUCCESS_URL, "missing_success_url"),
      cancel: boolSummary(process.env.STRIPE_CANCEL_URL, "missing_cancel_url"),
      portalReturn: boolSummary(process.env.STRIPE_PORTAL_RETURN_URL, "missing_portal_return_url"),
    },
  };
}

function getLaunchConfigStatus() {
  const publicSiteUrl = process.env.PUBLIC_SITE_URL || null;
  const clientOrigin = process.env.CLIENT_ORIGIN || null;
  const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    site: {
      publicSiteUrl,
      publicSiteUrlStatus: boolSummary(publicSiteUrl, "missing_public_site_url"),
      clientOrigin,
      clientOriginStatus: boolSummary(clientOrigin, "missing_client_origin"),
      allowedOriginsCount: allowedOrigins.length,
      extraOriginsCount: extraOrigins.length,
    },
    auth: {
      jwtSecret: boolSummary(process.env.JWT_SECRET, "missing_jwt_secret"),
      adminEmail: boolSummary(process.env.ADMIN_EMAIL, "missing_admin_email"),
      adminPassword: boolSummary(process.env.ADMIN_PASSWORD, "missing_admin_password"),
    },
    integrations: {
      googleOAuth: {
        configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        reason:
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? "ok"
            : "missing_config",
      },
    },
  };
}

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
}));
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 50,
  message: { error: "Too many requests. Please try again later." }
});
const chatLimiter = rateLimit({ 
  windowMs: 60 * 1000, 
  max: 5, 
  message: { error: "Dex is busy. Please wait a minute before sending more messages." } 
});
app.use("/api/", limiter);
app.use("/api/dex/chat", chatLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/dex", dexRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/affiliate", affiliateRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Konvict Artz - Dex AI Backend",
    routes: {
      health: "/health",
      apiHealth: "/api/health",
      diagnostics: "/api/diagnostics/providers",
    },
  });
});
app.get("/api", (req, res) => {
  res.json({
    status: "ok",
    service: "Konvict Artz - Dex AI Backend API",
    routes: {
      health: "/api/health",
      diagnostics: "/api/diagnostics/providers",
    },
  });
});
app.get("/health", (req, res) => res.json({ status: "ok", service: "Konvict Artz - Dex AI Backend" }));
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "Konvict Artz - Dex AI Backend" }));
app.get("/api/diagnostics/providers", (req, res) => {
  const providers = {
    ai: getAIStatus(),
    email: getEmailStatus(),
    ringcentral: getRingCentralStatus(),
    stripe: getStripeStatus(),
  };
  const launch = getLaunchConfigStatus();
  const providerReadiness = Object.values(providers).every((provider) => provider.configured !== false);
  const providerOperational = [providers.ai, providers.email, providers.stripe].every((provider) => provider.ready !== false);

  res.json({
    status: "ok",
    summary: {
      providersConfigured: providerReadiness,
      coreProvidersReady: providerOperational,
      ringcentralReady: providers.ringcentral.ready,
      publicSiteUrlSet: launch.site.publicSiteUrlStatus.configured,
      clientOriginSet: launch.site.clientOriginStatus.configured,
    },
    providers,
    launch,
    environment: {
      nodeEnv: process.env.NODE_ENV || "development",
      port: PORT,
    },
  });
});

// ── Inventory auto-check every hour ──────────────────────────────────────────
async function checkInventoryAlerts() {
  try {
    const { getDb } = await import("./db.js");
    const { sendLowInventoryAlert } = await import("./services/ringcentral.js");
    const db = getDb();
    const lowItems = await db.all(
      "SELECT * FROM inventory WHERE quantity <= low_threshold AND alerted = 0"
    );
    for (const item of lowItems) {
      await sendLowInventoryAlert(item.name, item.quantity);
      await db.run("UPDATE inventory SET alerted = 1 WHERE id = ?", [item.id]);
    }
    if (lowItems.length > 0) {
      console.log(`⚠️  Low inventory alerts sent for: ${lowItems.map(i => i.name).join(", ")}`);
    }
  } catch (err) {
    console.error("Inventory check error:", err.message);
  }
}

// ── Start server ──────────────────────────────────────────────────────────────
async function start() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, "../../data/konvict.db");
  const adminUsername = process.env.ADMIN_EMAIL || "konvictartzllc@gmail.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "Thuglife1423";

  await initDb({ dbPath, adminUsername, adminPassword });
  initEmail();
  await initRingCentral();
  await initAI();

  // Check inventory every hour
  setInterval(checkInventoryAlerts, 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`\n🚀 Konvict Artz - Dex AI Backend running on port ${PORT}`);
    console.log(`   Admin login: ${adminUsername}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Provider status: AI=${getAIStatus().reason}, Email=${getEmailStatus().reason}, RingCentral=${getRingCentralStatus().reason}\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { initEmail } from "./services/email.js";
import { initTwilio } from "./services/twilio.js";
import authRoutes from "./routes/auth.js";
import dexRoutes from "./routes/dex.js";
import paymentsRoutes from "./routes/payments.js";
import adminRoutes from "./routes/admin.js";
import affiliateRoutes from "./routes/affiliate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.CLIENT_ORIGIN || "https://www.konvict-artz.com",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  credentials: true,
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: "Too many messages. Please slow down." } });
app.use("/api/", limiter);
app.use("/api/dex/chat", chatLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/dex", dexRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/affiliate", affiliateRoutes);

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", service: "Konvict Artz - Dex AI Backend" }));

// ── Inventory auto-check every hour ──────────────────────────────────────────
async function checkInventoryAlerts() {
  try {
    const { getDb } = await import("./db.js");
    const { sendLowInventoryAlert } = await import("./services/twilio.js");
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
  const adminUsername = process.env.ADMIN_EMAIL || "admin@konvict-artz.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";

  await initDb({ dbPath, adminUsername, adminPassword });
  initEmail();
  initTwilio();

  // Check inventory every hour
  setInterval(checkInventoryAlerts, 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`\n🚀 Konvict Artz - Dex AI Backend running on port ${PORT}`);
    console.log(`   Admin login: ${adminUsername}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

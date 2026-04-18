import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { initEmail } from "./services/email.js";
import { initRingCentral } from "./services/ringcentral.js";
import { initAI } from "./services/ai.js";
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
  origin: process.env.CLIENT_ORIGIN || "https://www.konvict-artz.com",
  credentials: true,
}));
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
app.get("/health", (req, res) => res.json({ status: "ok", service: "Konvict Artz - Dex AI Backend" }));
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "Konvict Artz - Dex AI Backend" }));

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
  initRingCentral();
  initAI();

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

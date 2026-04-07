import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import userRoutes from "./routes/user.js";
import dexRoutes from "./routes/dex.js";
import { initDb } from "./db.js";
import { initEmailTransporter } from "./email.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || `http://localhost:${PORT}`;

async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required in environment");
  }

  // Initialize email transporter
  initEmailTransporter();

  const legacyDbPath = path.join(__dirname, "../data/dex.db");
  const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/konvict_artz.db");

  if (fs.existsSync(legacyDbPath) && !fs.existsSync(dbPath)) {
    fs.copyFileSync(legacyDbPath, dbPath);
  }

  const db = await initDb({
    dbPath,
    adminUsername: process.env.ADMIN_USERNAME || "admin",
    adminPassword: process.env.ADMIN_PASSWORD || "ChangeMe123!",
  });

  const app = express();
  app.locals.db = db;

  app.use(helmet({ contentSecurityPolicy: false }));
  const allowedOrigins = new Set(
    CLIENT_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
  );
  // Always allow localhost for local dev
  for (const port of ["4000", "3000", "5500", "8080"]) {
    allowedOrigins.add(`http://localhost:${port}`);
    allowedOrigins.add(`http://127.0.0.1:${port}`);
  }
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.has(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api", publicRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/dex", dexRoutes);

  const clientDir = path.resolve(__dirname, "../../client");
  app.use(express.static(clientDir));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });

  app.listen(PORT, () => {
    // Keep startup log concise and explicit for local testing.
    console.log(`Konvict Artz server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

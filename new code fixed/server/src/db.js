import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db = null;

export async function initDb({ dbPath, adminUsername, adminPassword }) {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");

  // ── Users ──────────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    UNIQUE NOT NULL,
      name        TEXT,
      password    TEXT,
      role        TEXT    NOT NULL DEFAULT 'user',
      access_type TEXT    NOT NULL DEFAULT 'none',
      trial_start TEXT,
      sub_expires TEXT,
      square_customer_id TEXT,
      square_subscription_id TEXT,
      referred_by TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Affiliates / Promoters ─────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      promo_code   TEXT    UNIQUE NOT NULL,
      signups      INTEGER NOT NULL DEFAULT 0,
      paid_subs    INTEGER NOT NULL DEFAULT 0,
      earnings     REAL    NOT NULL DEFAULT 0.0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Inventory ──────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      description  TEXT,
      category     TEXT,
      price_cents  INTEGER NOT NULL DEFAULT 0,
      quantity     INTEGER NOT NULL DEFAULT 0,
      low_threshold INTEGER NOT NULL DEFAULT 5,
      alerted      INTEGER NOT NULL DEFAULT 0,
      image_url    TEXT,
      square_catalog_id TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Chat Memory ────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      role       TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Appointments ──────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      title           TEXT    NOT NULL,
      description     TEXT,
      start_time      TEXT    NOT NULL,
      end_time        TEXT,
      google_event_id TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Promo Codes ────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    UNIQUE NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'free_trial',
      uses_left   INTEGER NOT NULL DEFAULT 1,
      created_by  INTEGER REFERENCES users(id),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Payments / Transactions ────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      square_payment_id TEXT,
      amount_cents    INTEGER NOT NULL,
      currency        TEXT    NOT NULL DEFAULT 'USD',
      status          TEXT    NOT NULL DEFAULT 'pending',
      affiliate_code  TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Seed admin user ────────────────────────────────────────────────────────
  const existing = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!existing) {
    const hashed = await bcrypt.hash(adminPassword, 12);
    await db.run(
      `INSERT INTO users (email, name, password, role, access_type)
       VALUES (?, ?, ?, 'admin', 'unlimited')`,
      [adminUsername, "Admin", hashed]
    );
    console.log(`✅ Admin user seeded: ${adminUsername}`);
  }

  console.log("✅ Database initialized");
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

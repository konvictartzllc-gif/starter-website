import bcrypt from "bcryptjs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDb({ dbPath, adminUsername, adminPassword }) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA journal_mode = WAL;");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      image TEXT NOT NULL,
      item_condition TEXT NOT NULL DEFAULT 'refurbished',
      inventory INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      service TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      total_price REAL,
      discounted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      is_promoter INTEGER NOT NULL DEFAULT 0,
      free_access INTEGER NOT NULL DEFAULT 0,
      referrals_count INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      square_payment_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS access_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      used INTEGER NOT NULL DEFAULT 0,
      used_by_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at TEXT
    );
  `);

  // Migration: add user_id column to bookings if it doesn't exist yet.
  try {
    await db.exec("ALTER TABLE bookings ADD COLUMN user_id INTEGER REFERENCES users(id);");
  } catch {
    // Column already exists — safe to ignore.
  }

  // Migration: add pricing/discount columns to bookings if missing.
  try {
    await db.exec("ALTER TABLE bookings ADD COLUMN total_price REAL;");
  } catch {
    // Column already exists — safe to ignore.
  }

  try {
    await db.exec("ALTER TABLE bookings ADD COLUMN discounted INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Column already exists — safe to ignore.
  }

  // Migration: store item condition and inventory for products.
  try {
    await db.exec("ALTER TABLE products ADD COLUMN item_condition TEXT NOT NULL DEFAULT 'refurbished';");
  } catch {
    // Column already exists — safe to ignore.
  }

  try {
    await db.exec("ALTER TABLE products ADD COLUMN inventory INTEGER NOT NULL DEFAULT 1;");
  } catch {
    // Column already exists — safe to ignore.
  }

  const userMigrations = [
    "ALTER TABLE users ADD COLUMN referral_code TEXT;",
    "ALTER TABLE users ADD COLUMN referred_by TEXT;",
    "ALTER TABLE users ADD COLUMN is_promoter INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN free_access INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN referrals_count INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN trial_started_at TEXT;",
    "ALTER TABLE users ADD COLUMN trial_expires_at TEXT;",
    "ALTER TABLE users ADD COLUMN referral_earnings_cents INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN subscribed_referrals_count INTEGER NOT NULL DEFAULT 0;",
  ];

  for (const sql of userMigrations) {
    try {
      await db.exec(sql);
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  try {
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);");
  } catch {
    // Index may fail on duplicate legacy data — do not block startup.
  }

  const existingAdmin = await db.get("SELECT id FROM admins WHERE username = ?", adminUsername);
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  if (!existingAdmin) {
    await db.run(
      "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
      adminUsername,
      passwordHash,
    );
  } else {
    await db.run(
      "UPDATE admins SET password_hash = ? WHERE id = ?",
      passwordHash,
      existingAdmin.id,
    );
  }

  return db;
}

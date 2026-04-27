

  // ── Ads ──────────────────────────────────────────────────────────────────

  import bcrypt from "bcryptjs";
  import fs from "fs";
  import path from "path";
  import sqlite3 from "sqlite3";
  import { open } from "sqlite";

  let db = null;

  async function ensureColumn(tableName, columnName, definition) {
    const columns = await db.all(`PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
      await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  export async function initDb({ dbPath, adminUsername, adminPassword }) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA foreign_keys = ON;");

    // ── Ads ──────────────────────────────────────────────────────────────────
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        image TEXT,
        target_location TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
    `);
    // ── User Memory ───────────────────────────────────────────────────────────
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_memory (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY(user_id, key),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
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
    await ensureColumn("users", "phone", "TEXT");
    await ensureColumn("users", "stripe_customer_id", "TEXT");
    await ensureColumn("users", "stripe_subscription_id", "TEXT");
    await ensureColumn("users", "stripe_checkout_session_id", "TEXT");
    // ── Affiliates / Promoters ────────────────────────────────────────────────
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
    await db.exec(`
      CREATE TABLE IF NOT EXISTS affiliate_invite_codes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        code         TEXT    UNIQUE NOT NULL,
        email        TEXT,
        name         TEXT,
        created_by   INTEGER REFERENCES users(id),
        claimed_by   INTEGER REFERENCES users(id),
        used         INTEGER NOT NULL DEFAULT 0,
        used_at      TEXT,
        expires_at   TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // ── Inventory ─────────────────────────────────────────────────────────────
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
    // ── Chat Memory ───────────────────────────────────────────────────────────
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
    // ── Promo Codes ───────────────────────────────────────────────────────────
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
    // ── Payments / Transactions ───────────────────────────────────────────────
    await db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        square_payment_id TEXT,
        stripe_payment_intent_id TEXT,
        stripe_checkout_session_id TEXT,
        stripe_subscription_id TEXT,
        amount_cents    INTEGER NOT NULL,
        currency        TEXT    NOT NULL DEFAULT 'USD',
        status          TEXT    NOT NULL DEFAULT 'pending',
        affiliate_code  TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await ensureColumn("payments", "stripe_payment_intent_id", "TEXT");
    await ensureColumn("payments", "stripe_checkout_session_id", "TEXT");
    await ensureColumn("payments", "stripe_subscription_id", "TEXT");
    // ── One-Time Authorization Codes ─────────────────────────────────────────-
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ota_codes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        code       TEXT    NOT NULL,
        action     TEXT    NOT NULL,
        expires_at TEXT    NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id     INTEGER PRIMARY KEY REFERENCES users(id),
        permissions TEXT,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS call_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        event      TEXT NOT NULL,
        caller     TEXT NOT NULL,
        timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_google_calendar_connections (
        user_id       INTEGER PRIMARY KEY REFERENCES users(id),
        google_email  TEXT,
        access_token  TEXT,
        refresh_token TEXT,
        token_expiry  TEXT,
        scope         TEXT,
        connected_at  TEXT NOT NULL DEFAULT (datetime('now')),
        last_sync_at  TEXT
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS learning_lessons (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        topic        TEXT,
        language     TEXT,
        level        TEXT,
        lesson_type  TEXT NOT NULL DEFAULT 'lesson',
        title        TEXT NOT NULL,
        content      TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS learning_quiz_attempts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL REFERENCES users(id),
        topic            TEXT,
        language         TEXT,
        score            INTEGER NOT NULL DEFAULT 0,
        total_questions  INTEGER NOT NULL DEFAULT 0,
        responses_json   TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS relationship_aliases (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        alias         TEXT NOT NULL,
        contact_name  TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, alias)
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS task_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        title         TEXT NOT NULL,
        details       TEXT,
        status        TEXT NOT NULL DEFAULT 'open',
        kind          TEXT NOT NULL DEFAULT 'task',
        source        TEXT,
        due_at        TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS communication_drafts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        channel       TEXT NOT NULL,
        target_name   TEXT,
        target_value  TEXT NOT NULL,
        subject       TEXT,
        body          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        source        TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        key           TEXT PRIMARY KEY,
        enabled       INTEGER NOT NULL DEFAULT 1,
        description   TEXT,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await db.exec(`
      INSERT INTO feature_flags (key, enabled, description)
      VALUES
        ('relationship_aliases', 1, 'Let users map relationship shortcuts like wife or boss to saved contacts.'),
        ('morning_briefing', 1, 'Enable Dex morning briefing summaries and planning suggestions.'),
        ('action_center', 1, 'Enable Dex action center for tasks and follow-up suggestions.'),
        ('learning_reminders', 1, 'Enable Dex daily learning reminder scheduling.')
      ON CONFLICT(key) DO NOTHING;
    `);
    // ── Seed admin user ─────────────────────────────────────────────────------
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

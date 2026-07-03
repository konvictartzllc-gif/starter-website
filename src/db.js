import { hashPassword } from "./security.js";

export const DEX_SHOP_ITEMS = [
  { id: "size-small", name: "Pocket Dex", price: 0, slot: "size" },
  { id: "size-big", name: "Big Dex", price: 0, slot: "size" },
  { id: "height-short", name: "Short Build", price: 0, slot: "height" },
  { id: "height-tall", name: "Tall Build", price: 0, slot: "height" },
  { id: "cap", name: "Color Cap", price: 40, slot: "hat" },
  { id: "crown", name: "Glow Crown", price: 120, slot: "hat" },
  { id: "curls", name: "Curly Hair", price: 75, slot: "hair" },
  { id: "mohawk", name: "Neon Mohawk", price: 85, slot: "hair" },
  { id: "glasses", name: "Star Glasses", price: 60, slot: "face" },
  { id: "visor", name: "Neon Visor", price: 90, slot: "face" },
  { id: "smile", name: "Big Smile", price: 0, slot: "mouth" },
  { id: "cool", name: "Cool Face", price: 35, slot: "mouth" },
  { id: "blush", name: "Blush Cheeks", price: 30, slot: "cheeks" },
  { id: "bowtie", name: "Tiny Bow Tie", price: 55, slot: "body" },
  { id: "chain", name: "Dex Chain", price: 100, slot: "body" },
];

export const COIN_PACKS = {
  starter: { coins: 100, amountCents: 199, name: "100 Dex Coins" },
  popular: { coins: 300, amountCents: 499, name: "300 Dex Coins" },
  mega: { coins: 750, amountCents: 999, name: "750 Dex Coins" },
};

export const FEATURE_FLAG_SEEDS = [
  ["relationship_aliases", 1, "Let users map relationship shortcuts like wife or boss to saved contacts."],
  ["morning_briefing", 1, "Enable Dex morning briefing summaries and planning suggestions."],
  ["action_center", 1, "Enable Dex action center for tasks and follow-up suggestions."],
  ["learning_reminders", 1, "Enable Dex daily learning reminder scheduling."],
];

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  image TEXT,
  target_location TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  access_type TEXT NOT NULL DEFAULT 'none',
  trial_start TEXT,
  sub_expires TEXT,
  square_customer_id TEXT,
  square_subscription_id TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  referred_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_memory (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY(user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS affiliates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  promo_code TEXT UNIQUE NOT NULL,
  signups INTEGER NOT NULL DEFAULT 0,
  paid_subs INTEGER NOT NULL DEFAULT 0,
  earnings REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS affiliate_invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  created_by INTEGER REFERENCES users(id),
  claimed_by INTEGER REFERENCES users(id),
  used INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  low_threshold INTEGER NOT NULL DEFAULT 5,
  alerted INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  square_catalog_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  google_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'free_trial',
  uses_left INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  square_payment_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_subscription_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  affiliate_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  zip_code TEXT NOT NULL,
  address TEXT,
  preferred_date TEXT,
  preferred_time TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ota_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  action TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  permissions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS integration_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_integration_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  account_id INTEGER REFERENCES integration_accounts(id),
  route_key TEXT NOT NULL UNIQUE,
  assigned_number TEXT,
  extension TEXT,
  permissions_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, assigned_number),
  UNIQUE(provider, extension)
);
CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  caller TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS call_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  caller TEXT,
  phone_number TEXT,
  message TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_google_calendar_connections (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  google_email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TEXT,
  scope TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at TEXT
);
CREATE TABLE IF NOT EXISTS learning_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic TEXT,
  language TEXT,
  level TEXT,
  lesson_type TEXT NOT NULL DEFAULT 'lesson',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS learning_quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic TEXT,
  language TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  responses_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS relationship_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  alias TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, alias)
);
CREATE TABLE IF NOT EXISTS task_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  kind TEXT NOT NULL DEFAULT 'task',
  source TEXT,
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS communication_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,
  target_name TEXT,
  target_value TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS request_rate_limits (
  rate_key TEXT PRIMARY KEY,
  bucket_start TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_created_at ON chat_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_items_user_status ON task_items(user_id, status);
CREATE INDEX IF NOT EXISTS idx_service_bookings_status ON service_bookings(status);
CREATE INDEX IF NOT EXISTS idx_payments_user_created_at ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_rate_limits_updated_at ON request_rate_limits(updated_at);
`;

let initPromise = null;

export async function ensureDatabase(env) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!env.DB) throw new Error("Missing Cloudflare D1 binding: DB");
    await env.DB.exec(SCHEMA_SQL);
    for (const [key, enabled, description] of FEATURE_FLAG_SEEDS) {
      await env.DB
        .prepare("INSERT INTO feature_flags (key, enabled, description) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
        .bind(key, enabled, description)
        .run();
    }

    const adminEmail = String(env.ADMIN_EMAIL || "").trim();
    const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
    if (adminEmail && adminPassword) {
      const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
      if (!existing) {
        const password = await hashPassword(adminPassword);
        await env.DB
          .prepare("INSERT INTO users (email, name, password, role, access_type) VALUES (?, 'Admin', ?, 'admin', 'unlimited')")
          .bind(adminEmail, password)
          .run();
      }
    }
  })().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

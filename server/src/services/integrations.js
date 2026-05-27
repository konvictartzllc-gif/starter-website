import crypto from "crypto";

export const PROVIDER_RINGCENTRAL = "ringcentral";
export const PROVIDER_TWILIO_VOICE = "twilio_voice";

export function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return raw;
}

export function generateRouteKey() {
  return `dex_${crypto.randomBytes(12).toString("hex")}`;
}

export async function ensureIntegrationTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS integration_accounts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      provider       TEXT NOT NULL,
      label          TEXT NOT NULL,
      shared         INTEGER NOT NULL DEFAULT 1,
      active         INTEGER NOT NULL DEFAULT 1,
      config_json    TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_integration_routes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      provider        TEXT NOT NULL,
      account_id      INTEGER REFERENCES integration_accounts(id),
      route_key       TEXT NOT NULL UNIQUE,
      assigned_number TEXT,
      extension       TEXT,
      permissions_json TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, assigned_number),
      UNIQUE(provider, extension)
    );
  `);
}

export async function ensureDefaultIntegrationAccount(db, provider = PROVIDER_RINGCENTRAL) {
  await ensureIntegrationTables(db);
  const existing = await db.get(
    "SELECT * FROM integration_accounts WHERE provider = ? AND shared = 1 ORDER BY id ASC LIMIT 1",
    [provider]
  );
  if (existing) return existing;
  const label = provider === PROVIDER_RINGCENTRAL ? "Shared RingCentral account" : "Shared voice account";
  const result = await db.run(
    `INSERT INTO integration_accounts (provider, label, shared, active, config_json)
     VALUES (?, ?, 1, 1, ?)`,
    [provider, label, JSON.stringify({ managedBy: "dex" })]
  );
  return db.get("SELECT * FROM integration_accounts WHERE id = ?", [result.lastID]);
}

export async function upsertUserIntegrationRoute(db, {
  userId,
  provider = PROVIDER_RINGCENTRAL,
  accountId = null,
  assignedNumber = null,
  extension = null,
  permissions = {},
  enabled = true,
}) {
  await ensureIntegrationTables(db);
  const account = accountId
    ? await db.get("SELECT * FROM integration_accounts WHERE id = ?", [accountId])
    : await ensureDefaultIntegrationAccount(db, provider);
  const routeKey = generateRouteKey();
  const normalizedNumber = normalizePhoneNumber(assignedNumber);
  const existing = await db.get(
    "SELECT * FROM user_integration_routes WHERE user_id = ? AND provider = ?",
    [userId, provider]
  );
  const permissionJson = JSON.stringify({
    answerCalls: Boolean(permissions.answerCalls ?? true),
    takeMessages: Boolean(permissions.takeMessages ?? true),
    sendSms: Boolean(permissions.sendSms ?? false),
    callBack: Boolean(permissions.callBack ?? false),
  });

  if (existing) {
    await db.run(
      `UPDATE user_integration_routes
          SET account_id = ?,
              assigned_number = ?,
              extension = ?,
              permissions_json = ?,
              enabled = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [account?.id || null, normalizedNumber || null, extension || null, permissionJson, enabled ? 1 : 0, existing.id]
    );
    return db.get("SELECT * FROM user_integration_routes WHERE id = ?", [existing.id]);
  }

  const result = await db.run(
    `INSERT INTO user_integration_routes
      (user_id, provider, account_id, route_key, assigned_number, extension, permissions_json, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, provider, account?.id || null, routeKey, normalizedNumber || null, extension || null, permissionJson, enabled ? 1 : 0]
  );
  return db.get("SELECT * FROM user_integration_routes WHERE id = ?", [result.lastID]);
}

export async function getUserIntegrationRoutes(db, userId) {
  await ensureIntegrationTables(db);
  return db.all(
    `SELECT uir.*, ia.label AS account_label, ia.shared AS account_shared
       FROM user_integration_routes uir
       LEFT JOIN integration_accounts ia ON ia.id = uir.account_id
      WHERE uir.user_id = ?
      ORDER BY uir.provider ASC`,
    [userId]
  );
}

export async function resolveVoiceRoute(db, { routeKey, provider, calledNumber, extension }) {
  await ensureIntegrationTables(db);
  const normalizedCalled = normalizePhoneNumber(calledNumber);
  const params = [];
  const clauses = ["uir.enabled = 1"];
  if (routeKey) {
    clauses.push("uir.route_key = ?");
    params.push(routeKey);
  }
  if (provider) {
    clauses.push("uir.provider IN (?, ?)");
    params.push(provider, PROVIDER_RINGCENTRAL);
  }
  if (normalizedCalled) {
    clauses.push("uir.assigned_number = ?");
    params.push(normalizedCalled);
  }
  if (extension) {
    clauses.push("uir.extension = ?");
    params.push(String(extension).trim());
  }
  if (clauses.length === 1) return null;

  return db.get(
    `SELECT uir.*, users.email, users.name
       FROM user_integration_routes uir
       JOIN users ON users.id = uir.user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY uir.updated_at DESC
      LIMIT 1`,
    params
  );
}

import { getDb } from "../db.js";
import { ensureDefaultIntegrationAccount, PROVIDER_RINGCENTRAL } from "./integrations.js";

let accessToken = null;
let tokenExpiresAt = 0;

let ringCentralStatus = {
  configured: false,
  ready: false,
  reason: "not_configured",
  detail: null,
  nextStep: null,
  lastSms: null,
};

let smsSenderNumberCache = null;

function envValue(name) {
  return String(process.env[name] || "").trim();
}

function envJwt(name) {
  return envValue(name).replace(/\s+/g, "");
}

function firstEnvValue(...names) {
  return names.map(envValue).find(Boolean) || "";
}

function firstEnvJwt(...names) {
  return names.map(envJwt).find(Boolean) || "";
}

function getConfig() {
  return {
    clientId: firstEnvValue("RC_CLIENT_ID", "RINGCENTRAL_CLIENT_ID"),
    clientSecret: firstEnvValue("RC_CLIENT_SECRET", "RINGCENTRAL_CLIENT_SECRET"),
    jwt: firstEnvJwt("RC_JWT", "RC_JWT_SECRET", "RINGCENTRAL_JWT"),
    username: firstEnvValue("RC_USERNAME", "RINGCENTRAL_USERNAME"),
    password: firstEnvValue("RC_PASSWORD", "RINGCENTRAL_PASSWORD"),
    extension: firstEnvValue("RC_EXTENSION", "RC_EXTENSION_NUMBER", "RINGCENTRAL_EXTENSION"),
    server: firstEnvValue("RC_SERVER", "RINGCENTRAL_SERVER") || "https://platform.ringcentral.com",
    fromNumber: firstEnvValue("RC_PHONE_NUMBER", "RINGCENTRAL_PHONE_NUMBER", "SUPPORT_PHONE", "OWNER_PHONE"),
    redirectUri: firstEnvValue("RC_REDIRECT_URI", "RINGCENTRAL_REDIRECT_URI"),
    oauthState: firstEnvValue("RC_OAUTH_STATE", "RINGCENTRAL_OAUTH_STATE"),
  };
}

function publicApiUrl() {
  return firstEnvValue("PUBLIC_API_URL", "RENDER_EXTERNAL_URL").replace(/\/+$/, "");
}

function ringCentralRedirectUri() {
  const { redirectUri } = getConfig();
  return redirectUri || `${publicApiUrl()}/oauth/callback`;
}

function ringCentralNextStep(reason, detail = "") {
  const lower = String(detail || "").toLowerCase();
  if (reason === "missing_credentials") {
    return "Add RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_JWT in Render, then redeploy.";
  }
  if (reason === "missing_from_number") {
    return "Add RC_PHONE_NUMBER in Render using the RingCentral number Dex should send calls/SMS from.";
  }
  if (reason === "network_error") {
    return "Render could not reach RingCentral. Redeploy once, then retry diagnostics; if it continues, check Render outbound/network status.";
  }
  if (reason === "permission_denied") {
    return "Add RingCentral app permissions for SMS, RingOut, ReadAccounts, and ReadCallLog, then generate a new JWT.";
  }
  if (reason === "auth_failed" && (lower.includes("oau-251") || lower.includes("grant type"))) {
    return "Your RingCentral app is not allowing JWT bearer login. Either connect it through the OAuth redirect URI or enable JWT/server-only auth and generate a fresh JWT.";
  }
  if (reason === "auth_failed") {
    return "Regenerate the RingCentral JWT from the same app/user as RC_CLIENT_ID and RC_CLIENT_SECRET, paste it into RC_JWT with no spaces, and redeploy.";
  }
  if (reason === "ok") return null;
  return "Check the RingCentral app credentials, JWT, scopes, and production/sandbox environment match.";
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return raw;
}

function hasRequiredConfig(config) {
  const hasJwtAuth = Boolean(config.jwt);
  const hasPasswordAuth = Boolean(config.username && config.password);
  return Boolean(config.clientId && config.clientSecret && (hasJwtAuth || hasPasswordAuth));
}

function hasRingCentralClientConfig(config) {
  return Boolean(config.clientId && config.clientSecret);
}

function parseConfigJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

async function getSharedRingCentralAccount() {
  const db = getDb();
  return ensureDefaultIntegrationAccount(db, PROVIDER_RINGCENTRAL);
}

async function getStoredOAuthTokens() {
  try {
    const account = await getSharedRingCentralAccount();
    const accountConfig = parseConfigJson(account?.config_json);
    return accountConfig.oauth || null;
  } catch {
    return null;
  }
}

async function saveStoredOAuthTokens(token, extra = {}) {
  const db = getDb();
  const account = await getSharedRingCentralAccount();
  const accountConfig = parseConfigJson(account?.config_json);
  const expiresIn = Number(token.expires_in || 3600);
  const nextOAuth = {
    ...accountConfig.oauth,
    ...extra,
    accessToken: token.access_token || accountConfig.oauth?.accessToken || "",
    refreshToken: token.refresh_token || accountConfig.oauth?.refreshToken || "",
    tokenType: token.token_type || accountConfig.oauth?.tokenType || "bearer",
    scope: token.scope || accountConfig.oauth?.scope || "",
    expiresAt: Date.now() + expiresIn * 1000,
    savedAt: new Date().toISOString(),
  };
  await db.run(
    `UPDATE integration_accounts
        SET config_json = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [JSON.stringify({ ...accountConfig, managedBy: "dex", oauth: nextOAuth }), account.id]
  );
  return nextOAuth;
}

async function clearStoredOAuthTokens(error = null) {
  try {
    const db = getDb();
    const account = await getSharedRingCentralAccount();
    const accountConfig = parseConfigJson(account?.config_json);
    const nextOAuth = {
      ...(accountConfig.oauth || {}),
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      lastError: error,
      clearedAt: new Date().toISOString(),
    };
    await db.run(
      `UPDATE integration_accounts
          SET config_json = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [JSON.stringify({ ...accountConfig, managedBy: "dex", oauth: nextOAuth }), account.id]
    );
  } catch {
    // Diagnostics still report the auth failure if token clearing cannot be recorded.
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const firstError = Array.isArray(json?.errors) ? json.errors[0] : null;
    const detail =
      json?.message ||
      firstError?.message ||
      json?.error_description ||
      json?.error ||
      text ||
      `${response.status} ${response.statusText}`;
    const code = firstError?.errorCode || json?.errorCode || json?.error;
    throw new Error(code ? `${detail} (${code})` : detail);
  }

  return json;
}

async function callRingCentralGet(path) {
  const config = getConfig();
  const token = await loginRingCentral();
  if (!token) {
    throw new Error(ringCentralStatus.detail || `RingCentral not ready: ${ringCentralStatus.reason}`);
  }

  return fetchJson(`${config.server}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function getSmsCapableSenderNumber() {
  if (smsSenderNumberCache) return smsSenderNumberCache;

  const response = await callRingCentralGet("/restapi/v1.0/account/~/extension/~/phone-number?perPage=100");
  const records = Array.isArray(response?.records) ? response.records : [];
  const smsNumber = records.find((record) => {
    const features = Array.isArray(record.features) ? record.features : [];
    return record.phoneNumber && features.some((feature) => String(feature).toLowerCase() === "smssender");
  });
  smsSenderNumberCache = normalizePhoneNumber(smsNumber?.phoneNumber || "");
  return smsSenderNumberCache;
}

async function postSms(fromNumber, toNumber, body) {
  return callRingCentral("/restapi/v1.0/account/~/extension/~/sms", {
    from: { phoneNumber: fromNumber },
    to: [{ phoneNumber: toNumber }],
    text: body,
  });
}

async function loginRingCentral(force = false) {
  const config = getConfig();
  const storedOAuth = await getStoredOAuthTokens();
  const hasStoredOAuth =
    Boolean(storedOAuth?.refreshToken) ||
    (Boolean(storedOAuth?.accessToken) && Number(storedOAuth.expiresAt || 0) > Date.now() + 60_000);

  if (!hasRingCentralClientConfig(config)) {
    ringCentralStatus = {
      configured: false,
      ready: false,
      reason: "missing_credentials",
      detail: "Missing RingCentral auth. Set RC_CLIENT_ID and RC_CLIENT_SECRET.",
      nextStep: ringCentralNextStep("missing_credentials"),
    };
    return null;
  }

  if (!hasRequiredConfig(config) && !hasStoredOAuth) {
    ringCentralStatus = {
      configured: true,
      ready: false,
      reason: "missing_credentials",
      detail: "Missing RingCentral login. Set RC_JWT or connect RingCentral through /oauth/callback.",
      nextStep: `Open RingCentral OAuth with redirect URI ${ringCentralRedirectUri()}, or add RC_JWT in Render.`,
    };
    return null;
  }

  if (!config.fromNumber) {
    ringCentralStatus = {
      configured: true,
      ready: false,
      reason: "missing_from_number",
      detail: "Missing RC_PHONE_NUMBER and no SUPPORT_PHONE / OWNER_PHONE fallback is set.",
      nextStep: ringCentralNextStep("missing_from_number"),
    };
    return null;
  }

  if (!force && accessToken && Date.now() < tokenExpiresAt - 60_000) {
    ringCentralStatus = {
      configured: true,
      ready: true,
      reason: "ok",
      detail: null,
      nextStep: null,
    };
    return accessToken;
  }

  ringCentralStatus = {
    configured: true,
    ready: false,
    reason: "initializing",
    detail: null,
    nextStep: null,
  };

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const useStoredAccessToken =
    !force &&
    storedOAuth?.accessToken &&
    Number(storedOAuth.expiresAt || 0) > Date.now() + 60_000;
  if (useStoredAccessToken) {
    accessToken = storedOAuth.accessToken;
    tokenExpiresAt = Number(storedOAuth.expiresAt || 0);
    ringCentralStatus = {
      configured: true,
      ready: true,
      reason: "ok",
      detail: null,
      nextStep: null,
    };
    return accessToken;
  }

  const body = new URLSearchParams();
  if (config.jwt) {
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", config.jwt);
  } else if (config.username && config.password) {
    body.set("grant_type", "password");
    body.set("username", config.username);
    body.set("password", config.password);
    if (config.extension) body.set("extension", config.extension);
  } else if (storedOAuth?.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", storedOAuth.refreshToken);
  }

  try {
    const token = await fetchJson(`${config.server}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    accessToken = token.access_token;
    tokenExpiresAt = Date.now() + ((token.expires_in || 3600) * 1000);
    if (token.refresh_token || storedOAuth?.refreshToken) {
      await saveStoredOAuthTokens(token, { authMode: config.jwt ? "jwt" : "oauth_refresh" });
    }
    ringCentralStatus = {
      configured: true,
      ready: true,
      reason: "ok",
      detail: null,
      nextStep: null,
    };
    console.log("RingCentral initialized");
    return accessToken;
  } catch (err) {
    if ((config.jwt || config.username) && storedOAuth?.refreshToken) {
      try {
        const refreshed = await refreshStoredOAuthToken(credentials, storedOAuth.refreshToken);
        accessToken = refreshed.accessToken;
        tokenExpiresAt = refreshed.expiresAt;
        return accessToken;
      } catch (refreshErr) {
        await clearStoredOAuthTokens(refreshErr.message);
      }
    }
    accessToken = null;
    tokenExpiresAt = 0;
    const lower = String(err?.message || "").toLowerCase();
    let reason = "login_failed";
    if (lower.includes("timeout") || lower.includes("network") || lower.includes("econn") || lower.includes("fetch failed")) {
      reason = "network_error";
    } else if (lower.includes("unauthorized") || lower.includes("invalid") || lower.includes("grant") || lower.includes("jwt")) {
      reason = "auth_failed";
    } else if (lower.includes("forbidden") || lower.includes("scope")) {
      reason = "permission_denied";
    }
    ringCentralStatus = {
      configured: true,
      ready: false,
      reason,
      detail: err?.message ? String(err.message).slice(0, 200) : "Unknown RingCentral login failure.",
      nextStep: ringCentralNextStep(reason, err?.message),
    };
    console.error("RingCentral init error:", err.message);
    return null;
  }
}

async function refreshStoredOAuthToken(credentials, refreshToken) {
  const config = getConfig();
  const token = await fetchJson(`${config.server}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const saved = await saveStoredOAuthTokens(token, { authMode: "oauth_refresh" });
  ringCentralStatus = {
    configured: true,
    ready: true,
    reason: "ok",
    detail: null,
    nextStep: null,
  };
  return saved;
}

export async function exchangeRingCentralOAuthCode({ code, state } = {}) {
  const config = getConfig();
  const safeCode = String(code || "").trim();
  const expectedState = config.oauthState;
  if (!safeCode) {
    throw new Error("Missing RingCentral OAuth code.");
  }
  if (!hasRingCentralClientConfig(config)) {
    throw new Error("Missing RC_CLIENT_ID or RC_CLIENT_SECRET.");
  }
  if (expectedState && state !== expectedState) {
    throw new Error("RingCentral OAuth state did not match.");
  }

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const token = await fetchJson(`${config.server}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: safeCode,
      redirect_uri: ringCentralRedirectUri(),
    }).toString(),
  });

  const saved = await saveStoredOAuthTokens(token, {
    authMode: "oauth_authorization_code",
    connectedAt: new Date().toISOString(),
  });
  accessToken = saved.accessToken;
  tokenExpiresAt = saved.expiresAt;
  ringCentralStatus = {
    configured: true,
    ready: true,
    reason: "ok",
    detail: null,
    nextStep: null,
  };
  return {
    ready: true,
    authMode: saved.authMode,
    expiresAt: saved.expiresAt,
    redirectUri: ringCentralRedirectUri(),
  };
}

async function callRingCentral(path, payload) {
  const config = getConfig();
  const token = await loginRingCentral();
  if (!token) {
    throw new Error(ringCentralStatus.detail || `RingCentral not ready: ${ringCentralStatus.reason}`);
  }

  try {
    return await fetchJson(`${config.server}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (/token/i.test(err.message) || /unauthorized/i.test(err.message)) {
      const refreshed = await loginRingCentral(true);
      if (!refreshed) throw err;
      return fetchJson(`${config.server}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }
    throw err;
  }
}

export async function initRingCentral() {
  await loginRingCentral();
}

export async function sendSms(to, body) {
  const { fromNumber } = getConfig();
  const normalizedFrom = normalizePhoneNumber(fromNumber);
  const normalizedTo = normalizePhoneNumber(to);
  if (!fromNumber) {
    throw new Error("RingCentral missing sender number, SMS skipped.");
  }
  if (!normalizedTo) {
    throw new Error("RingCentral missing recipient number, SMS skipped.");
  }
  try {
    await postSms(normalizedFrom, normalizedTo, body);
    console.log(`SMS sent to ${normalizedTo}`);
    ringCentralStatus = {
      ...ringCentralStatus,
      lastSms: { ok: true, to: normalizedTo, at: new Date().toISOString(), error: null },
    };
    return true;
  } catch (err) {
    const smsSenderNumber = await getSmsCapableSenderNumber().catch(() => "");
    if (smsSenderNumber && smsSenderNumber !== normalizedFrom) {
      try {
        await postSms(smsSenderNumber, normalizedTo, body);
        console.log(`SMS sent to ${normalizedTo} from discovered RingCentral SMS sender ${smsSenderNumber}`);
        ringCentralStatus = {
          ...ringCentralStatus,
          lastSms: { ok: true, to: normalizedTo, at: new Date().toISOString(), error: null },
        };
        return true;
      } catch (retryErr) {
        console.error("SMS retry error:", retryErr.message);
        ringCentralStatus = {
          ...ringCentralStatus,
          lastSms: { ok: false, to: normalizedTo, at: new Date().toISOString(), error: retryErr.message },
        };
        throw retryErr;
      }
    }
    ringCentralStatus = {
      ...ringCentralStatus,
      lastSms: { ok: false, to: normalizedTo, at: new Date().toISOString(), error: err.message },
    };
    console.error("SMS error:", err.message);
    throw err;
  }
}

export async function makeCall(to, message) {
  const { fromNumber } = getConfig();
  const normalizedFrom = normalizePhoneNumber(fromNumber);
  const normalizedTo = normalizePhoneNumber(to);
  if (!fromNumber) {
    console.warn("RingCentral missing sender number, call skipped.");
    return;
  }
  try {
    await callRingCentral("/restapi/v1.0/account/~/extension/~/ring-out", {
      from: { phoneNumber: normalizedFrom },
      to: { phoneNumber: normalizedTo },
      playPrompt: true,
    });
    console.log(`RingOut call placed to ${normalizedTo}`);
  } catch (err) {
    console.error("Call error:", err.message);
  }
}

export async function triggerEmergencyAlert(userInfo, triggerPhrase) {
  const emergencyNumber = process.env.EMERGENCY_PHONE || "2057492403";
  const adminPhone = process.env.ADMIN_PHONE || process.env.OWNER_PHONE || "2056239541";

  const smsMsg =
    `EMERGENCY ALERT - Dex AI detected a safety concern.\n` +
    `User: ${userInfo}\nPhrase: "${triggerPhrase}"\nPlease respond immediately.`;

  await makeCall(emergencyNumber, `Emergency alert from Konvict Artz Dex AI. User safety concern detected. Phrase: ${triggerPhrase}. User: ${userInfo}.`);
  await sendSms(adminPhone, smsMsg);
}

export async function sendLowInventoryAlert(itemName, quantity) {
  const adminPhone = process.env.ADMIN_PHONE || process.env.OWNER_PHONE || "2056239541";
  const msg =
    `LOW INVENTORY ALERT - Konvict Artz\n` +
    `Item: ${itemName}\nCurrent Stock: ${quantity} units\n` +
    `Please reorder soon.`;
  await sendSms(adminPhone, msg);
}

export function getRingCentralStatus() {
  return { ...ringCentralStatus };
}

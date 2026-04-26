let accessToken = null;
let tokenExpiresAt = 0;

let ringCentralStatus = {
  configured: false,
  ready: false,
  reason: "not_configured",
  detail: null,
};

function getConfig() {
  return {
    clientId: process.env.RC_CLIENT_ID,
    clientSecret: process.env.RC_CLIENT_SECRET,
    username: process.env.RC_USERNAME,
    password: process.env.RC_PASSWORD,
    server: process.env.RC_SERVER || "https://platform.ringcentral.com",
    fromNumber: process.env.RC_PHONE_NUMBER || process.env.SUPPORT_PHONE || process.env.OWNER_PHONE,
  };
}

function hasRequiredConfig(config) {
  return Boolean(config.clientId && config.clientSecret && config.username && config.password);
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
    const detail =
      json?.message ||
      json?.error_description ||
      json?.error ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }

  return json;
}

async function loginRingCentral(force = false) {
  const config = getConfig();

  if (!hasRequiredConfig(config)) {
    ringCentralStatus = {
      configured: false,
      ready: false,
      reason: "missing_credentials",
      detail: "Missing RC_CLIENT_ID, RC_CLIENT_SECRET, RC_USERNAME, or RC_PASSWORD.",
    };
    return null;
  }

  if (!config.fromNumber) {
    ringCentralStatus = {
      configured: true,
      ready: false,
      reason: "missing_from_number",
      detail: "Missing RC_PHONE_NUMBER and no SUPPORT_PHONE / OWNER_PHONE fallback is set.",
    };
    return null;
  }

  if (!force && accessToken && Date.now() < tokenExpiresAt - 60_000) {
    ringCentralStatus = {
      configured: true,
      ready: true,
      reason: "ok",
      detail: null,
    };
    return accessToken;
  }

  ringCentralStatus = {
    configured: true,
    ready: false,
    reason: "initializing",
    detail: null,
  };

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "password",
    username: config.username,
    password: config.password,
  });

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
    ringCentralStatus = {
      configured: true,
      ready: true,
      reason: "ok",
      detail: null,
    };
    console.log("RingCentral initialized");
    return accessToken;
  } catch (err) {
    accessToken = null;
    tokenExpiresAt = 0;
    const lower = String(err?.message || "").toLowerCase();
    let reason = "login_failed";
    if (lower.includes("timeout") || lower.includes("network") || lower.includes("econn") || lower.includes("fetch failed")) {
      reason = "network_error";
    } else if (lower.includes("unauthorized") || lower.includes("invalid") || lower.includes("grant")) {
      reason = "auth_failed";
    } else if (lower.includes("forbidden") || lower.includes("scope")) {
      reason = "permission_denied";
    }
    ringCentralStatus = {
      configured: true,
      ready: false,
      reason,
      detail: err?.message ? String(err.message).slice(0, 200) : "Unknown RingCentral login failure.",
    };
    console.error("RingCentral init error:", err.message);
    return null;
  }
}

async function callRingCentral(path, payload) {
  const config = getConfig();
  const token = await loginRingCentral();
  if (!token) {
    console.warn("RingCentral not ready, request skipped.");
    return null;
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
  if (!fromNumber) {
    console.warn("RingCentral missing sender number, SMS skipped.");
    return;
  }
  try {
    await callRingCentral("/restapi/v1.0/account/~/extension/~/sms", {
      from: { phoneNumber: fromNumber },
      to: [{ phoneNumber: to }],
      text: body,
    });
    console.log(`SMS sent to ${to}`);
  } catch (err) {
    console.error("SMS error:", err.message);
  }
}

export async function makeCall(to, message) {
  const { fromNumber } = getConfig();
  if (!fromNumber) {
    console.warn("RingCentral missing sender number, call skipped.");
    return;
  }
  try {
    await callRingCentral("/restapi/v1.0/account/~/extension/~/ring-out", {
      from: { phoneNumber: fromNumber },
      to: { phoneNumber: to },
      playPrompt: true,
    });
    console.log(`RingOut call placed to ${to}`);
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

  await makeCall(`+1${emergencyNumber}`, `Emergency alert from Konvict Artz Dex AI. User safety concern detected. Phrase: ${triggerPhrase}. User: ${userInfo}.`);
  await sendSms(`+1${adminPhone}`, smsMsg);
}

export async function sendLowInventoryAlert(itemName, quantity) {
  const adminPhone = process.env.ADMIN_PHONE || process.env.OWNER_PHONE || "2056239541";
  const msg =
    `LOW INVENTORY ALERT - Konvict Artz\n` +
    `Item: ${itemName}\nCurrent Stock: ${quantity} units\n` +
    `Please reorder soon.`;
  await sendSms(`+1${adminPhone}`, msg);
}

export function getRingCentralStatus() {
  return { ...ringCentralStatus };
}

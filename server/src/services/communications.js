import { getEmailStatus, sendCustomEmail } from "./email.js";

let communicationsStatus = {
  configured: false,
  ready: false,
  reason: "not_configured",
  provider: "twilio",
  detail: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable server-side SMS/calls.",
};

function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID?.trim(),
    authToken: process.env.TWILIO_AUTH_TOKEN?.trim(),
    fromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim(),
    callbackUrl: process.env.TWILIO_CALLBACK_URL?.trim(),
  };
}

function twilioReady(config = getTwilioConfig()) {
  return Boolean(config.accountSid && config.authToken && config.fromNumber);
}

export function initCommunications() {
  const config = getTwilioConfig();
  const ready = twilioReady(config);
  communicationsStatus = {
    configured: ready,
    ready,
    reason: ready ? "ok" : "missing_config",
    provider: "twilio",
    detail: ready
      ? "Twilio communications are configured."
      : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable server-side SMS/calls.",
  };
  return getCommunicationsStatus();
}

export function getCommunicationsStatus() {
  return { ...communicationsStatus };
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

async function callTwilio(path, formBody) {
  const config = getTwilioConfig();
  if (!twilioReady(config)) {
    throw new Error("Twilio communications are not configured.");
  }
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(formBody),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio request failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function sendSms(to, body) {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) throw new Error("Missing SMS recipient.");
  if (!body) throw new Error("Missing SMS body.");
  const config = getTwilioConfig();
  const result = await callTwilio("/Messages.json", {
    From: config.fromNumber,
    To: normalizedTo,
    Body: body,
  });
  return Boolean(result.sid);
}

export async function makeCall(to, twimlUrl = null) {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) throw new Error("Missing call recipient.");
  const config = getTwilioConfig();
  const url = twimlUrl || config.callbackUrl;
  if (!url) throw new Error("Missing TWILIO_CALLBACK_URL for outbound calls.");
  const result = await callTwilio("/Calls.json", {
    From: config.fromNumber,
    To: normalizedTo,
    Url: url,
  });
  return Boolean(result.sid);
}

export async function triggerEmergencyAlert(userInfo, message) {
  const emailTarget = process.env.EMERGENCY_ALERT_EMAIL || process.env.ADMIN_EMAIL;
  const smsTarget = process.env.EMERGENCY_ALERT_PHONE || process.env.ADMIN_PHONE;
  const emailBody = `Dex emergency alert for ${userInfo}.\n\nMessage:\n${message}`;
  const smsBody = `Dex emergency alert for ${userInfo}. Message: ${String(message || "").replace(/\s+/g, " ").slice(0, 240)}`;
  const deliveries = [];

  if (emailTarget) {
    deliveries.push(
      sendCustomEmail({
        to: emailTarget,
        subject: "Dex emergency alert",
        body: emailBody,
      })
    );
  }
  if (smsTarget) {
    deliveries.push(sendSms(smsTarget, smsBody));
  }

  if (deliveries.length === 0) return false;
  const results = await Promise.allSettled(deliveries);
  const delivered = results.some((result) => result.status === "fulfilled" && result.value);
  if (!delivered) {
    const error = results.find((result) => result.status === "rejected")?.reason;
    if (error) throw error;
  }
  return delivered;
}

export async function sendLowInventoryAlert(itemName, quantity) {
  const target = process.env.INVENTORY_ALERT_EMAIL || process.env.ADMIN_EMAIL;
  if (!target) return false;
  const sent = await sendCustomEmail({
    to: target,
    subject: "Konvict Artz low inventory alert",
    body: `${itemName} is at ${quantity} units.`,
  });
  if (!sent) {
    const status = getEmailStatus();
    throw new Error(status.lastError || status.reason || "Inventory alert email was not sent.");
  }
  return true;
}

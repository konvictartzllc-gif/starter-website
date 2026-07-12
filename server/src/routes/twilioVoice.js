import { Router } from "express";
import { getDb } from "../db.js";
import { PROVIDER_TWILIO_VOICE, resolveVoiceRoute } from "../services/integrations.js";
import { getPublicApiBaseUrl } from "../deploy.js";

const router = Router();

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(res, body) {
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
}

function publicBaseUrl(req) {
  const configured = getPublicApiBaseUrl();
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function webhookToken(req) {
  return String(req.query.token || req.body.token || req.get("x-dex-webhook-token") || "").trim();
}

function requireWebhookToken(req, res) {
  const expected = (process.env.TWILIO_VOICE_WEBHOOK_TOKEN || "").trim();
  if (!expected) {
    twiml(res.status(503), "<Say>Dex voice answering is not configured yet.</Say>");
    return false;
  }
  if (webhookToken(req) !== expected) {
    twiml(res.status(403), "<Say>Dex could not verify this call route.</Say>");
    return false;
  }
  return true;
}

async function ensureVoiceTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS call_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      event      TEXT NOT NULL,
      caller     TEXT NOT NULL,
      timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS call_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      caller       TEXT,
      phone_number TEXT,
      message      TEXT NOT NULL,
      handled      INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function resolveUser(req) {
  const db = getDb();
  const route = await resolveVoiceRoute(db, {
    routeKey: String(req.query.route || req.body.route || "").trim(),
    provider: String(req.query.provider || req.body.provider || PROVIDER_TWILIO_VOICE).trim(),
    calledNumber: req.body.To || req.body.Called || req.query.To || req.query.Called,
    extension: req.query.extension || req.body.Extension,
  });
  if (route) {
    return {
      id: route.user_id,
      email: route.email,
      name: route.name,
      integrationRoute: route,
    };
  }

  const userId = String(req.query.userId || req.body.userId || "").trim();
  const email = String(req.query.email || req.body.email || process.env.DEX_TWILIO_OWNER_EMAIL || process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

  if (userId) {
    const user = await db.get("SELECT id, email, name FROM users WHERE id = ?", [userId]);
    if (user) return user;
  }
  if (email) {
    const user = await db.get("SELECT id, email, name FROM users WHERE lower(email) = ?", [email]);
    if (user) return user;
  }
  return null;
}

function callerLabel(req) {
  return String(req.body.CallerName || req.body.From || req.query.From || "Unknown caller").trim();
}

function callerNumber(req) {
  return String(req.body.From || req.query.From || "").trim();
}

function actionUrl(req, path, userId) {
  const token = encodeURIComponent(process.env.TWILIO_VOICE_WEBHOOK_TOKEN || "");
  const route = encodeURIComponent(String(req.query.route || req.body.route || "").trim());
  const routePart = route ? `&route=${route}` : "";
  return `${publicBaseUrl(req)}/api/twilio/voice/${path}?token=${token}&userId=${encodeURIComponent(userId)}${routePart}`;
}

async function saveCallMessage({ userId, caller, phoneNumber, message, event = "twilio_message" }) {
  const db = getDb();
  await ensureVoiceTables(db);
  await db.run(
    "INSERT INTO call_events (user_id, event, caller, timestamp) VALUES (?, ?, ?, ?)",
    [userId, event, caller || "Unknown caller", new Date().toISOString()]
  );
  await db.run(
    "INSERT INTO call_messages (user_id, caller, phone_number, message) VALUES (?, ?, ?, ?)",
    [userId, caller || "Unknown caller", phoneNumber || null, message]
  );
}

router.post("/", async (req, res) => {
  if (!requireWebhookToken(req, res)) return;
  const user = await resolveUser(req);
  if (!user) {
    twiml(res, "<Say>Dex could not find the owner for this assistant line. Goodbye.</Say><Hangup/>");
    return;
  }

  const caller = xmlEscape(callerLabel(req));
  const gatherUrl = xmlEscape(actionUrl(req, "message", user.id));
  const recordUrl = xmlEscape(actionUrl(req, "recording", user.id));
  const prompt =
    `Hi, this is Dex, the assistant for ${xmlEscape(user.name || user.email || "this person")}. ` +
    "They are busy right now. Please say your name and the message you want me to pass along after the tone.";

  twiml(
    res,
    `<Say>${prompt}</Say>` +
      `<Gather input="speech" action="${gatherUrl}" method="POST" timeout="6" speechTimeout="auto" language="en-US">` +
      `<Say>Please leave your name and message now.</Say>` +
      `</Gather>` +
      `<Record action="${recordUrl}" method="POST" maxLength="90" playBeep="true" transcribe="true" />` +
      `<Say>I did not receive a message. Goodbye.</Say><Hangup/>`
  );
});

router.post("/message", async (req, res) => {
  if (!requireWebhookToken(req, res)) return;
  const user = await resolveUser(req);
  if (!user) {
    twiml(res, "<Say>Dex could not save this message. Goodbye.</Say><Hangup/>");
    return;
  }

  const speech = String(req.body.SpeechResult || "").trim();
  const caller = callerLabel(req);
  const phoneNumber = callerNumber(req);
  if (speech) {
    await saveCallMessage({ userId: user.id, caller, phoneNumber, message: speech });
    twiml(res, "<Say>Thank you. I saved your message and will pass it along. Goodbye.</Say><Hangup/>");
    return;
  }

  twiml(
    res,
    `<Say>I did not catch that clearly. Please leave your name and message after the tone.</Say>` +
      `<Record action="${xmlEscape(actionUrl(req, "recording", user.id))}" method="POST" maxLength="90" playBeep="true" transcribe="true" />` +
      `<Hangup/>`
  );
});

router.post("/recording", async (req, res) => {
  if (!requireWebhookToken(req, res)) return;
  const user = await resolveUser(req);
  if (!user) {
    twiml(res, "<Say>Dex could not save this recording. Goodbye.</Say><Hangup/>");
    return;
  }

  const caller = callerLabel(req);
  const phoneNumber = callerNumber(req);
  const recordingUrl = String(req.body.RecordingUrl || "").trim();
  const recordingSid = String(req.body.RecordingSid || "").trim();
  const message =
    recordingUrl
      ? `Caller left a voice recording: ${recordingUrl}${recordingSid ? ` (${recordingSid})` : ""}`
      : "Caller reached Dex but did not leave a clear spoken message.";
  await saveCallMessage({ userId: user.id, caller, phoneNumber, message, event: "twilio_recording" });

  twiml(res, "<Say>Thank you. I saved your message and will pass it along. Goodbye.</Say><Hangup/>");
});

export default router;

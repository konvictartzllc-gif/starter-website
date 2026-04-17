import { Router } from "express";
import { body, validationResult } from "express-validator";
import OpenAI from "openai";
import { requireUser, optionalUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { triggerEmergencyAlert, sendLowInventoryAlert, sendSms, makeCall } from "../services/ringcentral.js";
import { createEvent, listEvents } from "../services/calendar.js";
import { verifyOta, spamFilter } from "../middleware/security.js";
const router = Router();

// ...existing code...

// ── Get OpenAI client ─────────────────────────────────────────────────────────
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ── POST /api/dex/chat ────────────────────────────────────────────────────────
router.post("/chat", requireUser, spamFilter, [body("message").notEmpty().trim()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { message } = req.body;
  const db = getDb();
  const userId = req.user.id;

  // Check access
  const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const isAdmin = user.role === "admin";
  let hasAccess = isAdmin;

  if (!hasAccess) {
    if (user.access_type === "paid") {
      if (user.sub_expires && new Date() > new Date(user.sub_expires)) {
        await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [userId]);
        return res.status(403).json({ error: "subscription_expired", message: "Your subscription has expired. Renew for $9.99/month to keep chatting with Dex." });
      }
      hasAccess = true;
    } else if (user.access_type === "trial") {
      const trialEnd = new Date(user.trial_start);
      trialEnd.setDate(trialEnd.getDate() + 3);
      if (new Date() > trialEnd) {
        await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [userId]);
        return res.status(403).json({ error: "trial_expired", message: "Your 3-day free trial has ended. Subscribe for $9.99/month to continue." });
      }
      hasAccess = true;
    } else if (user.access_type === "unlimited") {
      hasAccess = true;
    }
  }

  if (!hasAccess) {
    return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial or subscribe for $9.99/month." });
  }

  // Emergency detection
  if (detectEmergency(message)) {
    const userInfo = `${user.name || "Unknown"} (${user.email})`;
    await triggerEmergencyAlert(userInfo, message);
    return res.json({
      reply: "Hey, I hear you and I want you to know you matter. I've just notified someone who can help right away. Please reach out to the 988 Suicide & Crisis Lifeline by calling or texting 988. You're not alone.",
      emergency: true,
    });
  }

  // Load chat history (last 20 messages for memory)
  const history = await db.all(
    "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    [userId]
  );
  const messages = history.reverse().map((h) => ({ role: h.role, content: h.content }));

  // Add current message
  messages.push({ role: "user", content: message });

  // Save user message to history
  await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [userId, message]);

  try {
    const openai = getOpenAI();
    const systemPrompt = isAdmin ? DEX_ADMIN_SYSTEM_PROMPT : DEX_SYSTEM_PROMPT;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 500,
      temperature: 0.85,
    });

    const reply = completion.choices[0].message.content.trim();

    // Save Dex's reply to history
    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, reply]);

    // Check for appointment intent and sync to calendar
    const appointmentIntent = /\b(schedule|book|appointment|set up|add to (my )?calendar)\b/i.test(message);
    if (appointmentIntent) {
      try {
        // Simple extraction for demo/starter purposes - in production use a more robust parser
        const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Default to tomorrow
        await createEvent({
          title: `Konvict Artz: ${message.substring(0, 30)}...`,
          description: `Dex AI Appointment: ${message}`,
          startTime,
          endTime: new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(),
        });
      } catch (e) {
        console.error("Auto-calendar sync failed:", e.message);
      }
    }

    return res.json({ reply, appointmentIntent });
  } catch (err) {
    console.error("OpenAI error:", err.message);
    // Fallback response
    const fallback = "Hey, I'm having a little trouble connecting right now. Give me a sec and try again — I'll be right here!";
    return res.json({ reply: fallback });
  }
});

// ...existing code...

// ...existing code...
// ── PHONE & SMS HANDLING (STUBS) ─────────────────────────────────────────────
// These endpoints are for integration with telephony/SMS APIs (e.g., Twilio, RingCentral)
// Basic phone call handler: logs call and returns success
router.post("/phone/incoming", async (req, res) => {
  // Log the incoming call details (for now, just log the body)
  console.log("Incoming phone call:", req.body);
  // Respond with a generic success message
  res.json({ status: "ok", message: "Phone call received. (Basic handler: no action taken)" });
});

// SMS endpoint temporarily disabled for launch
router.post("/sms/incoming", (req, res) => {
  res.status(503).json({ error: "SMS endpoint is temporarily disabled for launch. Please contact support if you need this feature enabled." });
});

// ── CALENDAR EVENT CREATION (STUB) ──────────────────────────────────────────
router.post("/calendar/event", requireUser, async (req, res) => {
  // Calendar event creation is not yet implemented. This endpoint is production-safe.
  res.status(501).json({ status: "not_implemented", message: "Calendar event creation is not available yet. Please contact support if you need this feature enabled." });
});

// ── ONE-TIME AUTHORIZATION (UTILITY STUB) ───────────────────────────────────
// In production, use a secure, expiring token or code for one-time auth
// Example: Generate and verify a one-time code for sensitive actions
// One-time authorization endpoint (not implemented)
router.post("/one-time-auth", requireUser, async (req, res) => {
  // One-time authorization is not yet implemented. This endpoint is production-safe.
  res.status(501).json({ status: "not_implemented", message: "One-time authorization is not available yet. Please contact support if you need this feature enabled." });
});

// ── Get OpenAI client ─────────────────────────────────────────────────────────
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ── POST /api/dex/chat ────────────────────────────────────────────────────────
router.post("/chat", requireUser, [body("message").notEmpty().trim()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { message } = req.body;
  const db = getDb();
  const userId = req.user.id;

  // Check access
  const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const isAdmin = user.role === "admin";
  let hasAccess = isAdmin;

  if (!hasAccess) {
    if (user.access_type === "paid") {
      if (user.sub_expires && new Date() > new Date(user.sub_expires)) {
        await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [userId]);
        return res.status(403).json({ error: "subscription_expired", message: "Your subscription has expired. Renew for $9.99/month to keep chatting with Dex." });
      }
      hasAccess = true;
    } else if (user.access_type === "trial") {
      const trialEnd = new Date(user.trial_start);
      trialEnd.setDate(trialEnd.getDate() + 3);
      if (new Date() > trialEnd) {
        await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [userId]);
        return res.status(403).json({ error: "trial_expired", message: "Your 3-day free trial has ended. Subscribe for $9.99/month to continue." });
      }
      hasAccess = true;
    } else if (user.access_type === "unlimited") {
      hasAccess = true;
    }
  }

  if (!hasAccess) {
    return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial or subscribe for $9.99/month." });
  }

  // Emergency detection
  if (detectEmergency(message)) {
    const userInfo = `${user.name || "Unknown"} (${user.email})`;
    await triggerEmergencyAlert(userInfo, message);
    return res.json({
      reply: "Hey, I hear you and I want you to know you matter. I've just notified someone who can help right away. Please reach out to the 988 Suicide & Crisis Lifeline by calling or texting 988. You're not alone.",
      emergency: true,
    });
  }

  // Load chat history (last 20 messages for memory)
  const history = await db.all(
    "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    [userId]
  );
  const messages = history.reverse().map((h) => ({ role: h.role, content: h.content }));

  // Add current message
  messages.push({ role: "user", content: message });

  // Save user message to history
  await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [userId, message]);

  try {
    const openai = getOpenAI();
    const systemPrompt = isAdmin ? DEX_ADMIN_SYSTEM_PROMPT : DEX_SYSTEM_PROMPT;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 500,
      temperature: 0.85,
    });

    const reply = completion.choices[0].message.content.trim();

    // Save Dex's reply to history
    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, reply]);

    // Check for appointment intent
    const appointmentIntent = /\b(schedule|book|appointment|set up|add to (my )?calendar)\b/i.test(message);

    return res.json({ reply, appointmentIntent });
  } catch (err) {
    console.error("OpenAI error:", err.message);
    // Fallback response
    const fallback = "Hey, I'm having a little trouble connecting right now. Give me a sec and try again — I'll be right here!";
    return res.json({ reply: fallback });
  }
});

// ── POST /api/dex/access — check access without chatting ─────────────────────
router.get("/access", requireUser, async (req, res) => {
  const db = getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: "Not found" });

  let access = user.access_type;
  let trialDaysLeft = null;

  if (access === "trial" && user.trial_start) {
    const trialEnd = new Date(user.trial_start);
    trialEnd.setDate(trialEnd.getDate() + 3);
    const now = new Date();
    if (now > trialEnd) {
      access = "expired";
      await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [user.id]);
    } else {
      trialDaysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    }
  }

  return res.json({ access, trialDaysLeft });
});

// ── POST /api/dex/appointment — save appointment ──────────────────────────────
router.post("/appointment", requireUser, [
  body("title").notEmpty().trim(),
  body("start_time").notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, start_time, end_time } = req.body;
  const db = getDb();

  const result = await db.run(
    `INSERT INTO appointments (user_id, title, description, start_time, end_time)
     VALUES (?, ?, ?, ?, ?)`,
    [req.user.id, title, description || null, start_time, end_time || null]
  );

  return res.json({ success: true, id: result.lastID, title, start_time });
});

// ── GET /api/dex/appointments ─────────────────────────────────────────────────
router.get("/appointments", requireUser, async (req, res) => {
  const db = getDb();
  const appts = await db.all(
    "SELECT * FROM appointments WHERE user_id = ? ORDER BY start_time ASC",
    [req.user.id]
  );
  return res.json(appts);
});

// ── GET /api/dex/history — chat history ──────────────────────────────────────
router.get("/history", requireUser, async (req, res) => {
  const db = getDb();
  const history = await db.all(
    "SELECT role, content, created_at FROM chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 100",
    [req.user.id]
  );
  return res.json(history);
});

export default router;

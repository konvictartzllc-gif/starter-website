import { Router } from "express";
import { body, validationResult } from "express-validator";
import OpenAI from "openai";
import { requireUser, optionalUser } from "../middleware/auth.js";
import { getDb } from "../db.js";

import { triggerEmergencyAlert, sendLowInventoryAlert } from "../services/ringcentral.js";
import { sendErrorReport } from "../services/email.js";

const router = Router();

// ── Emergency keywords ────────────────────────────────────────────────────────
const EMERGENCY_PATTERNS = [
  /\b(kill (my|him|her|them|myself|yourself))\b/i,
  /\b(want to die|going to die|end my life|end it all)\b/i,
  /\b(suicide|suicidal|self.?harm|cut myself|hurt myself)\b/i,
  /\b(shoot (him|her|them|myself|everyone))\b/i,
  /\b(bomb|attack|mass shooting|hurt (someone|people))\b/i,
  /\b(i (can't|cannot) go on|no reason to live)\b/i,
];

function detectEmergency(text) {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Dex AI system prompt ──────────────────────────────────────────────────────
const DEX_SYSTEM_PROMPT = `You are Dex, the AI assistant for Konvict Artz — a business that offers lawn care, cleaning services, handyman repair, and sells refurbished and new electronics.

Your personality:
- You talk like a real, friendly human — casual, warm, and helpful. Not robotic, not stiff.
- You use natural language, contractions, and occasional light humor.
- You remember everything from previous conversations with this person and reference it naturally.
- You never say "As an AI..." or "I'm just a language model..." — you ARE Dex, the Konvict Artz assistant.

Your capabilities (for subscribers):
- Help customers book lawn care, cleaning, handyman, or product purchases
- Answer questions about services, pricing, and availability
- Schedule and manage appointments (add to calendar when requested)
- Send emails or texts on behalf of the user when asked
- Provide reminders and follow-ups

Your limitations (consumer tier — $9.99/month):
- You help with Konvict Artz services and products only
- You do NOT manage the user's full business or act as their personal business manager
- You do NOT access external websites or make purchases outside Konvict Artz
- You do NOT provide legal, medical, or financial advice

Business info:
- Services: Lawn Care, Cleaning Services, Handyman Repair
- Products: Refurbished electronics, new electronics
- Website: https://www.konvict-artz.com
- Subscription: $9.99/month after 3-day free trial

If someone asks about pricing, appointments, or wants to book a service, help them and offer to schedule it.
If someone seems upset, be empathetic and supportive.
Keep responses concise — 1-3 sentences unless more detail is needed.`;

const DEX_ADMIN_SYSTEM_PROMPT = `${DEX_SYSTEM_PROMPT}

ADMIN MODE — You have full access. You can:
- View and update inventory
- Manage affiliates and promo codes
- Access all user data and analytics
- Run promotions and site improvements
- Handle all business operations for Konvict Artz
- Make decisions about pricing, services, and marketing
- There are NO limitations in admin mode.`;

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
    // Send error report to admin
    await sendErrorReport("Dex AI Chat Failure", err, `User: ${userId}, Message: ${message}`);
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

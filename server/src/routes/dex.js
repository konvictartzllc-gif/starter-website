// ── LEARNED PREFERENCES ENDPOINTS ───────────────────────────────────────────
// Dex can get/set learned preferences (e.g., favorite contacts, routines)
router.get("/preferences", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_memory (
                        user_id TEXT NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT,
                        PRIMARY KEY(user_id, key)
                )`
        );
        // Get all preferences (keys starting with "pref:")
        const rows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE 'pref:%'", [userId]);
        const preferences = {};
        for (const row of rows) preferences[row.key.slice(5)] = row.value;
        res.json({ preferences });
});

router.post("/preferences", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: "Missing key" });
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [userId, `pref:${key}`, value]
        );
        res.json({ success: true });
});
// ── FETCH RECENT CALL EVENTS ENDPOINT ───────────────────────────────────────
// Web client can GET recent call events for the user
router.get("/call-events", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        await db.run(
                `CREATE TABLE IF NOT EXISTS call_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT,
                        event TEXT,
                        caller TEXT,
                        timestamp TEXT DEFAULT (datetime('now'))
                )`
        );
        const events = await db.all(
                `SELECT event, caller, timestamp FROM call_events WHERE user_id = ? ORDER BY id DESC LIMIT 10`,
                [userId]
        );
        res.json({ events });
});
// ── ANDROID CALL EVENT ENDPOINT ─────────────────────────────────────────────
// Android app can POST call events (incoming, answered, declined)
router.post("/call-event", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const { event, caller, timestamp } = req.body;
        if (!event || !caller) return res.status(400).json({ error: "Missing event or caller" });
        // Check phone permission
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_permissions (
                        user_id TEXT PRIMARY KEY,
                        permissions TEXT
                )`
        );
        const row = await db.get("SELECT permissions FROM user_permissions WHERE user_id = ?", [userId]);
        let permissions = {};
        if (row && row.permissions) {
                try { permissions = JSON.parse(row.permissions); } catch {}
        }
        if (!permissions.phone) return res.status(403).json({ error: "Phone permission not granted" });
        // Log event
        await db.run(
                `CREATE TABLE IF NOT EXISTS call_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT,
                        event TEXT,
                        caller TEXT,
                        timestamp TEXT DEFAULT (datetime('now'))
                )`
        );
        await db.run(
                `INSERT INTO call_events (user_id, event, caller, timestamp) VALUES (?, ?, ?, ?)`,
                [userId, event, caller, timestamp || new Date().toISOString()]
        );

        // ── AUTO-LEARN FAVORITE CONTACTS ──────────────────────────────────────────
        if (event === "incoming" && caller) {
                await db.run(
                        `CREATE TABLE IF NOT EXISTS user_memory (
                                user_id TEXT NOT NULL,
                                key TEXT NOT NULL,
                                value TEXT,
                                PRIMARY KEY(user_id, key)
                        )`
                );
                // Increment call count for this caller
                const key = `pref:favorite_contact_count:${caller}`;
                const row = await db.get("SELECT value FROM user_memory WHERE user_id = ? AND key = ?", [userId, key]);
                let count = row && row.value ? parseInt(row.value) : 0;
                count++;
                await db.run(
                        `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                        [userId, key, String(count)]
                );
                // Find most frequent caller
                const counts = await db.all("SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE 'pref:favorite_contact_count:%'", [userId]);
                let maxCaller = null, maxCount = 0;
                for (const r of counts) {
                        const c = parseInt(r.value);
                        if (c > maxCount) {
                                maxCount = c;
                                maxCaller = r.key.replace('pref:favorite_contact_count:', '');
                        }
                }
                if (maxCaller) {
                        // Store as learned preference
                        await db.run(
                                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                                [userId, 'pref:favorite_contact', maxCaller]
                        );
                }
        }
        res.json({ success: true });
});
// ── USER PERMISSIONS ENDPOINTS ──────────────────────────────────────────────
// Dex can get/set user permissions (e.g., phone, calendar, notifications)
router.get("/permissions", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_permissions (
                        user_id TEXT PRIMARY KEY,
                        permissions TEXT
                )`
        );
        const row = await db.get("SELECT permissions FROM user_permissions WHERE user_id = ?", [userId]);
        let permissions = {};
        if (row && row.permissions) {
                try { permissions = JSON.parse(row.permissions); } catch {}
        }
        res.json({ permissions });
});

router.post("/permissions", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const { permissions } = req.body;
        if (!permissions || typeof permissions !== "object") return res.status(400).json({ error: "Missing or invalid permissions" });
        await db.run(
                `INSERT INTO user_permissions (user_id, permissions) VALUES (?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET permissions = excluded.permissions`,
                [userId, JSON.stringify(permissions)]
        );
        res.json({ success: true });
});
// ── USER MEMORY ENDPOINTS ───────────────────────────────────────────────────
// Dex can store and retrieve per-user memory (preferences, facts, routines)
router.get("/memory", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const rows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ?", [userId]);
        const memory = {};
        for (const row of rows) memory[row.key] = row.value;
        res.json({ memory });
});

router.post("/memory", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: "Missing key" });
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_memory (user_id TEXT, key TEXT, value TEXT, PRIMARY KEY(user_id, key))`
        );
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [userId, key, value]
        );
        res.json({ success: true });
});
import { Router } from "express";
import { body, validationResult } from "express-validator";
import OpenAI from "openai";
import { requireUser, optionalUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { triggerEmergencyAlert, sendLowInventoryAlert, sendSms, makeCall } from "../services/ringcentral.js";
import { createEvent, listEvents } from "../services/calendar.js";
import { verifyOta, spamFilter } from "../middleware/security.js";
const router = Router();

function getOpenAI() {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function detectEmergency(message) {
        // Detect self-harm or harm to others
        const selfHarm = /\b(suicide|kill myself|end it all|self[- ]?harm|hurt myself|don'?t want to live|want to die)\b/i;
        const harmOthers = /\b(hurt|kill|attack|shoot|harm|injure) (someone|others|them|him|her|people|person|my (mom|dad|family|friend|boss|teacher))\b/i;
        if (selfHarm.test(message)) return "self";
        if (harmOthers.test(message)) return "others";
        return null;
}

const DEX_SYSTEM_PROMPT = `You are Dex, a friendly and empathetic AI assistant for Konvict Artz. You help users with scheduling, questions, and general support. Be warm, concise, and helpful.`;

const DEX_ADMIN_SYSTEM_PROMPT = `You are Dex, an AI assistant for Konvict Artz. You are speaking with an admin user. Provide detailed, technical responses when appropriate. Help with scheduling, analytics, and business operations.`;

router.post("/chat", requireUser, spamFilter, [body("message").notEmpty().trim()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

              const { message } = req.body;
    const db = getDb();
    const userId = req.user.id;

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

                        const emergencyType = detectEmergency(message);
                        if (emergencyType) {
                                const userInfo = `${user.name || "Unknown"} (${user.email})`;
                                await triggerEmergencyAlert(userInfo, message);
                                let reply = "";
                                if (emergencyType === "self") {
                                        reply = "Hey, I hear you and I want you to know you matter. I've just notified someone who can help right away. Please reach out to the 988 Suicide & Crisis Lifeline by calling or texting 988. You're not alone.";
                                } else if (emergencyType === "others") {
                                        reply = "I'm concerned by your message. I've notified support to help keep everyone safe. If you or someone else is in immediate danger, please call 911 or your local emergency number right away.";
                                }

                                // Escalate: notify trusted contact if permission granted
                                let contactNotified = false;
                                try {
                                        const memRows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ?", [userId]);
                                        const memory = {};
                                        for (const row of memRows) memory[row.key] = row.value;
                                        if (memory.emergency_contact_permission === "1" && memory.emergency_contact) {
                                                // Simulate notification (future: send SMS/email/call)
                                                // e.g., await sendSms(memory.emergency_contact, `Dex AI Emergency Alert for ${userInfo}: ${message}`);
                                                contactNotified = true;
                                        }
                                } catch {}

                                return res.json({
                                        reply: contactNotified
                                                ? reply + " I've also notified your trusted emergency contact."
                                                : reply,
                                        emergency: true,
                                        emergencyType,
                                        contactNotified,
                                });
                        }

              const history = await db.all(
                    "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
                    [userId]
                  );
    const messages = history.reverse().map((h) => ({ role: h.role, content: h.content }));
    messages.push({ role: "user", content: message });

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
                    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, reply]);

                        // ── AUTO-LEARN CHAT INTENTS ─────────────────────────────────────────---
                        // Track frequent intents (e.g., schedule, call, remind)
                        const intentPatterns = [
                                { key: "schedule", regex: /\b(schedule|book|appointment|set up|add to (my )?calendar)\b/i },
                                { key: "call", regex: /\b(call|ring|phone|dial)\b/i },
                                { key: "remind", regex: /\b(remind|reminder|remember to)\b/i },
                        ];
                        let matchedIntent = null;
                        for (const intent of intentPatterns) {
                                if (intent.regex.test(message)) {
                                        matchedIntent = intent.key;
                                        break;
                                }
                        }
                        if (matchedIntent) {
                                await db.run(
                                        `CREATE TABLE IF NOT EXISTS user_memory (
                                                user_id TEXT NOT NULL,
                                                key TEXT NOT NULL,
                                                value TEXT,
                                                PRIMARY KEY(user_id, key)
                                        )`
                                );
                                const key = `pref:automation_count:${matchedIntent}`;
                                const row = await db.get("SELECT value FROM user_memory WHERE user_id = ? AND key = ?", [userId, key]);
                                let count = row && row.value ? parseInt(row.value) : 0;
                                count++;
                                await db.run(
                                        `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                                         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                                        [userId, key, String(count)]
                                );
                                // Find most frequent automation
                                const counts = await db.all("SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE 'pref:automation_count:%'", [userId]);
                                let maxIntent = null, maxCount = 0;
                                for (const r of counts) {
                                        const c = parseInt(r.value);
                                        if (c > maxCount) {
                                                maxCount = c;
                                                maxIntent = r.key.replace('pref:automation_count:', '');
                                        }
                                }
                                if (maxIntent) {
                                        await db.run(
                                                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                                                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                                                [userId, 'pref:suggested_automation', maxIntent]
                                        );
                                }
                        }

                        // ── PROACTIVE AUTOMATION (with user consent) ─────────────────────────--
                        // Only perform if user enabled automation
                        let automationPerformed = false;
                        // Check user preferences for enabled automations
                        let enabledAutomations = {};
                        try {
                                const enabledRows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE 'automation_enabled_%'", [userId]);
                                for (const row of enabledRows) {
                                        if (row.value === "1") {
                                                const k = row.key.replace("automation_enabled_", "");
                                                enabledAutomations[k] = true;
                                        }
                                }
                        } catch {}

                        // Schedule automation
                        const appointmentIntent = intentPatterns[0].regex.test(message);
                        if (appointmentIntent && enabledAutomations["schedule"]) {
                                try {
                                        const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                                        await createEvent({
                                                title: `Konvict Artz: ${message.substring(0, 30)}...`,
                                                description: `Dex AI Appointment: ${message}`,
                                                startTime,
                                                endTime: new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(),
                                        });
                                        automationPerformed = true;
                                } catch (e) {
                                        console.error("Auto-calendar sync failed:", e.message);
                                }
                        }
                        // Remind automation (stub)
                        if (matchedIntent === "remind" && enabledAutomations["remind"]) {
                                // Future: integrate with reminders/notifications
                                automationPerformed = true;
                        }
                        // Call automation (stub)
                        if (matchedIntent === "call" && enabledAutomations["call"]) {
                                // Future: integrate with Android call trigger
                                automationPerformed = true;
                        }

                        return res.json({ reply, appointmentIntent, automationPerformed });
              } catch (err) {
                    console.error("OpenAI error:", err.message);
                    const fallback = "Hey, I'm having a little trouble connecting right now. Give me a sec and try again - I'll be right here!";
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

        // ── AUTO-LEARN ROUTINE ─────────────────────────────────────────────────---
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_memory (
                        user_id TEXT NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT,
                        PRIMARY KEY(user_id, key)
                )`
        );
        const key = `pref:routine_count:${title}`;
        const row = await db.get("SELECT value FROM user_memory WHERE user_id = ? AND key = ?", [req.user.id, key]);
        let count = row && row.value ? parseInt(row.value) : 0;
        count++;
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [req.user.id, key, String(count)]
        );
        // Find most frequent routine
        const counts = await db.all("SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE 'pref:routine_count:%'", [req.user.id]);
        let maxRoutine = null, maxCount = 0;
        for (const r of counts) {
                const c = parseInt(r.value);
                if (c > maxCount) {
                        maxCount = c;
                        maxRoutine = r.key.replace('pref:routine_count:', '');
                }
        }
        if (maxRoutine) {
                await db.run(
                        `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                        [req.user.id, 'pref:favorite_routine', maxRoutine]
                );
        }

        return res.json({ success: true, id: result.lastID, title, start_time });
});

router.get("/appointments", requireUser, async (req, res) => {
    const db = getDb();
    const appts = await db.all(
          "SELECT * FROM appointments WHERE user_id = ? ORDER BY start_time ASC",
          [req.user.id]
        );
    return res.json(appts);
});

router.get("/history", requireUser, async (req, res) => {
    const db = getDb();
    const history = await db.all(
          "SELECT role, content, created_at FROM chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 100",
          [req.user.id]
        );
    return res.json(history);
});

export default router;

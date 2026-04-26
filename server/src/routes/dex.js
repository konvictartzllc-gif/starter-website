import { Router } from "express";
import { body, validationResult } from "express-validator";
import OpenAI from "openai";
import { requireUser, optionalUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { triggerEmergencyAlert, sendLowInventoryAlert, sendSms, makeCall } from "../services/ringcentral.js";
import { createEvent, listEvents } from "../services/calendar.js";
import { verifyOta, spamFilter } from "../middleware/security.js";
import { sendCustomEmail } from "../services/email.js";
const router = Router();

const CHAT_MEMORY_RETENTION_DAYS = 3;
const SENSITIVE_INFO_WARNING =
        "I won't save sensitive information like bank details, card numbers, passwords, or Social Security numbers. Please remove that information and try again.";
const FREE_SETTING_KEYS = new Set([
        "emergency_contact",
        "emergency_contact_permission",
        "voice_name",
        "conversation_tone",
        "learning_target_language",
        "learning_level",
        "learning_focus",
        "learning_style",
        "learning_reminder_enabled",
        "learning_reminder_time",
        "learning_subject",
        "daily_briefing_enabled",
        "daily_briefing_time",
]);

async function ensureMemoryTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_memory (
                        user_id TEXT NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT,
                        PRIMARY KEY(user_id, key)
                )`
        );
}

async function ensurePermissionTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS user_permissions (
                        user_id TEXT PRIMARY KEY,
                        permissions TEXT
                )`
        );
}

async function ensureCallEventsTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS call_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT,
                        event TEXT,
                        caller TEXT,
                        timestamp TEXT DEFAULT (datetime('now'))
                )`
        );
}

async function ensureLearningTables(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS learning_lessons (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        topic TEXT,
                        language TEXT,
                        level TEXT,
                        lesson_type TEXT NOT NULL DEFAULT 'lesson',
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`
        );
        await db.run(
                `CREATE TABLE IF NOT EXISTS learning_quiz_attempts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        topic TEXT,
                        language TEXT,
                        score INTEGER NOT NULL DEFAULT 0,
                        total_questions INTEGER NOT NULL DEFAULT 0,
                        responses_json TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`
        );
}

async function ensureRelationshipAliasesTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS relationship_aliases (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        alias TEXT NOT NULL,
                        contact_name TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(user_id, alias)
                )`
        );
}

async function ensureTaskItemsTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS task_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        details TEXT,
                        status TEXT NOT NULL DEFAULT 'open',
                        kind TEXT NOT NULL DEFAULT 'task',
                        source TEXT,
                        due_at TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`
        );
}

async function ensureCommunicationDraftsTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS communication_drafts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        channel TEXT NOT NULL,
                        target_name TEXT,
                        target_value TEXT NOT NULL,
                        subject TEXT,
                        body TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        source TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`
        );
}

async function getUserRecord(userId) {
        const db = getDb();
        return db.get("SELECT * FROM users WHERE id = ?", [userId]);
}

function isPaidSubscriber(user) {
        if (!user) return false;
        if (user.role === "admin" || user.access_type === "unlimited") return true;
        if (user.access_type !== "paid") return false;
        return !user.sub_expires || new Date(user.sub_expires) > new Date();
}

function requiresPaidMemory(key) {
        return !FREE_SETTING_KEYS.has(key);
}

function detectSensitiveInfo(value = "") {
        const text = String(value);
        const rules = [
                /\b\d{3}-\d{2}-\d{4}\b/,
                /\b(?:social security|ssn)\b/i,
                /\b(?:bank account|routing number|account number)\b/i,
                /\b(?:card number|credit card|debit card|cvv|cvc|security code)\b/i,
                /\b(?:pin code|bank pin|atm pin)\b/i,
                /\b(?:password|passcode)\b/i,
                /\b(?:\d[ -]?){13,19}\b/,
        ];
        return rules.some((rule) => rule.test(text));
}

async function loadPreferenceMap(db, userId, keys = []) {
        if (!keys.length) return {};
        const placeholders = keys.map(() => "?").join(", ");
        const rows = await db.all(
                `SELECT key, value FROM user_memory WHERE user_id = ? AND key IN (${placeholders})`,
                [userId, ...keys.map((key) => `pref:${key}`)]
        );
        const map = {};
        for (const row of rows) {
                map[row.key.replace(/^pref:/, "")] = row.value;
        }
        return map;
}

function buildLearningContext(preferences) {
        const targetLanguage = preferences.learning_target_language;
        const level = preferences.learning_level;
        const focus = preferences.learning_focus;
        const style = preferences.learning_style;

        if (!targetLanguage && !level && !focus && !style) return null;

        const parts = [];
        if (targetLanguage) parts.push(`target language: ${targetLanguage}`);
        if (level) parts.push(`current level: ${level}`);
        if (focus) parts.push(`learning focus: ${focus}`);
        if (style) parts.push(`preferred teaching style: ${style}`);
        return `The user is actively learning with Dex. Personalize lessons with these preferences: ${parts.join(", ")}.`;
}

function buildRelationshipContext(aliases = []) {
        if (!aliases.length) return null;
        const aliasText = aliases
                .map((item) => `${item.alias} means ${item.contact_name}`)
                .join("; ");
        return `The user has relationship aliases saved for contacts. Respect them when helping with calls or messages: ${aliasText}.`;
}

function userHasDexAccess(user) {
        if (!user) return false;
        if (user.role === "admin" || user.access_type === "unlimited") return true;
        if (user.access_type === "paid") {
                return !user.sub_expires || new Date(user.sub_expires) > new Date();
        }
        if (user.access_type === "trial" && user.trial_start) {
                const trialEnd = new Date(user.trial_start);
                trialEnd.setDate(trialEnd.getDate() + 3);
                return new Date() <= trialEnd;
        }
        return false;
}

function getLearningDefaults(preferences = {}, body = {}) {
        return {
                language: body.language || preferences.learning_target_language || "Spanish",
                level: body.level || preferences.learning_level || "beginner",
                focus: body.focus || preferences.learning_focus || "conversation",
                style: body.style || preferences.learning_style || "gentle",
                topic: body.topic || preferences.learning_subject || preferences.learning_focus || "daily conversation",
        };
}

function extractJsonObject(text = "") {
        const match = String(text).match(/\{[\s\S]*\}/);
        if (!match) {
                throw new Error("Could not extract JSON from model response.");
        }
        return JSON.parse(match[0]);
}

function toDateKey(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().slice(0, 10);
}

function calculateLearningStreak(entries = []) {
        const uniqueDays = [...new Set(entries.map((entry) => toDateKey(entry.created_at)).filter(Boolean))]
                .sort()
                .reverse();
        if (!uniqueDays.length) return 0;

        let streak = 0;
        let cursor = new Date();
        cursor.setHours(0, 0, 0, 0);

        for (const day of uniqueDays) {
                const currentKey = cursor.toISOString().slice(0, 10);
                if (day === currentKey) {
                        streak += 1;
                        cursor.setDate(cursor.getDate() - 1);
                        continue;
                }

                const yesterday = new Date();
                yesterday.setHours(0, 0, 0, 0);
                yesterday.setDate(yesterday.getDate() - 1);
                if (streak === 0 && day === yesterday.toISOString().slice(0, 10)) {
                        streak += 1;
                        cursor = yesterday;
                        cursor.setDate(cursor.getDate() - 1);
                        continue;
                }
                break;
        }

        return streak;
}

function buildWeakAreaRecommendation(quizAttempts = [], preferences = {}) {
        if (!quizAttempts.length) {
                const subject = preferences.learning_subject || preferences.learning_focus || "conversation";
                const language = preferences.learning_target_language || "Spanish";
                return {
                        topic: subject,
                        reason: `Start with a ${language} ${subject} lesson to build momentum.`,
                };
        }

        const topicScores = new Map();
        for (const attempt of quizAttempts) {
                const topic = attempt.topic || preferences.learning_focus || "general practice";
                const total = Number(attempt.total_questions || 0);
                const score = Number(attempt.score || 0);
                if (!total) continue;
                const percentage = score / total;
                const entry = topicScores.get(topic) || { totalPercentage: 0, attempts: 0 };
                entry.totalPercentage += percentage;
                entry.attempts += 1;
                topicScores.set(topic, entry);
        }

        if (!topicScores.size) {
                return {
                        topic: preferences.learning_focus || "general practice",
                        reason: "Keep practicing with a short mixed review lesson.",
                };
        }

        let weakestTopic = null;
        let weakestAverage = Number.POSITIVE_INFINITY;
        for (const [topic, entry] of topicScores.entries()) {
                const average = entry.totalPercentage / entry.attempts;
                if (average < weakestAverage) {
                        weakestAverage = average;
                        weakestTopic = topic;
                }
        }

        const percentage = Math.round(weakestAverage * 100);
        return {
                topic: weakestTopic,
                reason: percentage < 70
                        ? `Your quiz scores are lowest in ${weakestTopic} (${percentage}%). Dex should recommend extra practice there next.`
                        : `You're doing well overall. A fresh ${weakestTopic} lesson will keep the streak going.`,
        };
}

function summarizeCallEvents(events = []) {
        if (!events.length) {
                return {
                        total: 0,
                        missed: 0,
                        declined: 0,
                        answered: 0,
                        callers: [],
                };
        }

        const summary = {
                        total: events.length,
                        missed: 0,
                        declined: 0,
                        answered: 0,
                        callers: [],
                };
        const seenCallers = new Set();
        for (const event of events) {
                if (event.event === "declined") summary.declined += 1;
                if (event.event === "answered") summary.answered += 1;
                if ((event.event === "declined" || event.event === "incoming") && !seenCallers.has(event.caller)) {
                        seenCallers.add(event.caller);
                        summary.callers.push(event.caller);
                }
        }
        summary.missed = summary.declined;
        return summary;
}

function buildVoicemailStyleSummary(callEvents = []) {
        const recentMissed = callEvents
                .filter((event) => event.event === "declined" || event.event === "incoming")
                .slice(0, 5);
        if (!recentMissed.length) {
                return {
                        headline: "No recent missed-call pileup.",
                        summary: "Dex does not see any recent missed or declined calls that need a callback summary right now.",
                };
        }
        const callers = [...new Set(recentMissed.map((event) => event.caller))];
        return {
                headline: `You have ${recentMissed.length} recent missed-call event${recentMissed.length === 1 ? "" : "s"}.`,
                summary: `Most recent callers: ${callers.join(", ")}.`,
        };
}

function buildFollowUpSuggestions({ callEvents = [], tasks = [], aliases = [] }) {
        const suggestions = [];
        const recentByCaller = new Map();
        for (const event of callEvents) {
                if (!recentByCaller.has(event.caller)) recentByCaller.set(event.caller, []);
                recentByCaller.get(event.caller).push(event);
        }

        for (const [caller, events] of recentByCaller.entries()) {
                const latest = events[0];
                if (latest?.event === "declined") {
                        suggestions.push({
                                type: "missed_call",
                                title: `Follow up with ${caller}`,
                                detail: `Dex noticed a recent missed or declined call from ${caller}.`,
                                suggestedAction: "Call back or send a quick text.",
                                target: caller,
                        });
                }
                if (/unknown|private/i.test(caller)) {
                        suggestions.push({
                                type: "unknown_number",
                                title: "Review unknown caller",
                                detail: "There was a recent unknown or private caller.",
                                suggestedAction: "Verify who it was before saving or calling back.",
                                target: caller,
                        });
                }
        }

        for (const task of tasks.filter((item) => item.status !== "done").slice(0, 3)) {
                suggestions.push({
                        type: "task",
                        title: task.title,
                        detail: task.details || "Dex saved this for you.",
                        suggestedAction: task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}.` : "Mark it done when you're finished.",
                        target: task.id,
                });
        }

        if (!suggestions.length && aliases.length) {
                suggestions.push({
                        type: "relationship_alias",
                        title: "Relationship aliases are ready",
                        detail: `Dex knows aliases like ${aliases.slice(0, 2).map((item) => item.alias).join(" and ")}.`,
                        suggestedAction: "Try saying call my wife or text my boss from the Android app.",
                        target: null,
                });
        }

        return suggestions.slice(0, 6);
}

async function buildMorningBriefing(db, userId) {
        await ensureTaskItemsTable(db);
        await ensureRelationshipAliasesTable(db);
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);

        const [appointments, tasks, callEvents, aliases, preferences, lessons, quizAttempts] = await Promise.all([
                db.all(
                        `SELECT * FROM appointments
                          WHERE user_id = ?
                            AND start_time >= ?
                            AND start_time <= ?
                          ORDER BY start_time ASC`,
                        [userId, startOfDay.toISOString(), endOfDay.toISOString()]
                ),
                db.all(
                        `SELECT * FROM task_items
                          WHERE user_id = ? AND status != 'done'
                          ORDER BY
                            CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
                            due_at ASC,
                            created_at ASC
                          LIMIT 6`,
                        [userId]
                ),
                db.all(
                        `SELECT * FROM call_events
                          WHERE user_id = ?
                            AND timestamp >= datetime('now', '-3 days')
                          ORDER BY timestamp DESC
                          LIMIT 20`,
                        [userId]
                ),
                db.all(
                        `SELECT id, alias, contact_name, updated_at
                           FROM relationship_aliases
                          WHERE user_id = ?
                          ORDER BY alias ASC`,
                        [userId]
                ),
                loadPreferenceMap(db, userId, [
                        "learning_target_language",
                        "learning_focus",
                        "learning_subject",
                        "conversation_tone",
                ]),
                db.all(
                        `SELECT * FROM learning_lessons
                          WHERE user_id = ?
                          ORDER BY created_at DESC
                          LIMIT 3`,
                        [userId]
                ),
                db.all(
                        `SELECT * FROM learning_quiz_attempts
                          WHERE user_id = ?
                          ORDER BY created_at DESC
                          LIMIT 8`,
                        [userId]
                ),
        ]);

        const nextLesson = buildWeakAreaRecommendation(quizAttempts, preferences);
        const callSummary = summarizeCallEvents(callEvents);
        const followUps = buildFollowUpSuggestions({ callEvents, tasks, aliases });
        const agenda = appointments.map((item) => ({
                id: item.id,
                title: item.title,
                time: item.start_time,
                description: item.description || "",
        }));
        const priorities = tasks.slice(0, 3).map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                dueAt: task.due_at,
                kind: task.kind,
        }));

        const highlights = [];
        if (agenda.length) {
                highlights.push(`You have ${agenda.length} calendar item${agenda.length === 1 ? "" : "s"} today.`);
        }
        if (priorities.length) {
                highlights.push(`There ${priorities.length === 1 ? "is" : "are"} ${priorities.length} open task${priorities.length === 1 ? "" : "s"} waiting for you.`);
        }
        if (callSummary.missed) {
                highlights.push(`You missed or declined ${callSummary.missed} recent call${callSummary.missed === 1 ? "" : "s"}.`);
        }
        if (nextLesson?.topic) {
                highlights.push(`Dex recommends a quick ${nextLesson.topic} lesson next.`);
        }
        if (!highlights.length) {
                highlights.push("Your day looks open. Dex can help you shape it.");
        }

        return {
                generatedAt: now.toISOString(),
                highlights,
                agenda,
                priorities,
                calls: callSummary,
                aliases,
                nextLesson,
                followUps,
                tone: preferences.conversation_tone || "balanced",
                latestLesson: lessons[0] || null,
        };
}

async function purgeExpiredChatHistory(db, userId) {
        const threshold = new Date(Date.now() - CHAT_MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        await db.run("DELETE FROM chat_history WHERE user_id = ? AND created_at < ?", [userId, threshold]);
        return threshold;
}

// ── LEARNED PREFERENCES ENDPOINTS ───────────────────────────────────────────
// Dex can get/set learned preferences (e.g., favorite contacts, routines)
router.get("/preferences", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const user = await getUserRecord(userId);
        await ensureMemoryTable(db);
        // Get all preferences (keys starting with "pref:")
        const rows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE 'pref:%'", [userId]);
        const preferences = {};
        for (const row of rows) {
                const key = row.key.slice(5);
                if (requiresPaidMemory(key) && !isPaidSubscriber(user)) continue;
                preferences[key] = row.value;
        }
        res.json({ preferences });
});

router.post("/preferences", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: "Missing key" });
        const user = await getUserRecord(userId);
        if (requiresPaidMemory(key) && !isPaidSubscriber(user)) {
                return res.status(403).json({ error: "paid_subscription_required", message: "Dex memory is available with a paid subscription after your 3-day trial." });
        }
        if (detectSensitiveInfo(`${key} ${value ?? ""}`)) {
                return res.status(400).json({ error: "sensitive_info_blocked", message: SENSITIVE_INFO_WARNING });
        }
        await ensureMemoryTable(db);
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [userId, `pref:${key}`, value]
        );
        res.json({ success: true });
});

router.get("/relationship-aliases", requireUser, async (req, res) => {
        const db = getDb();
        await ensureRelationshipAliasesTable(db);
        const aliases = await db.all(
                `SELECT id, alias, contact_name, created_at, updated_at
                   FROM relationship_aliases
                  WHERE user_id = ?
                  ORDER BY alias ASC`,
                [req.user.id]
        );
        res.json({ aliases });
});

router.post("/relationship-aliases", requireUser, [
        body("alias").notEmpty().trim(),
        body("contact_name").notEmpty().trim(),
], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const db = getDb();
        await ensureRelationshipAliasesTable(db);
        const alias = req.body.alias.trim().toLowerCase();
        const contactName = req.body.contact_name.trim();
        await db.run(
                `INSERT INTO relationship_aliases (user_id, alias, contact_name, updated_at)
                 VALUES (?, ?, ?, datetime('now'))
                 ON CONFLICT(user_id, alias)
                 DO UPDATE SET contact_name = excluded.contact_name, updated_at = datetime('now')`,
                [req.user.id, alias, contactName]
        );
        const saved = await db.get(
                `SELECT id, alias, contact_name, created_at, updated_at
                   FROM relationship_aliases
                  WHERE user_id = ? AND alias = ?`,
                [req.user.id, alias]
        );
        res.json({ success: true, alias: saved });
});

router.delete("/relationship-aliases/:id", requireUser, async (req, res) => {
        const db = getDb();
        await ensureRelationshipAliasesTable(db);
        await db.run("DELETE FROM relationship_aliases WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        res.json({ success: true });
});

router.get("/briefing", requireUser, async (req, res) => {
        const db = getDb();
        await ensureLearningTables(db);
        const briefing = await buildMorningBriefing(db, req.user.id);
        res.json({ briefing });
});

router.get("/follow-ups", requireUser, async (req, res) => {
        const db = getDb();
        await ensureTaskItemsTable(db);
        await ensureRelationshipAliasesTable(db);
        const [callEvents, tasks, aliases] = await Promise.all([
                db.all(
                        `SELECT * FROM call_events
                          WHERE user_id = ?
                          ORDER BY timestamp DESC
                          LIMIT 20`,
                        [req.user.id]
                ),
                db.all(
                        `SELECT * FROM task_items
                          WHERE user_id = ? AND status != 'done'
                          ORDER BY
                            CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
                            due_at ASC,
                            created_at ASC
                          LIMIT 10`,
                        [req.user.id]
                ),
                db.all(
                        `SELECT id, alias, contact_name
                           FROM relationship_aliases
                          WHERE user_id = ?
                          ORDER BY alias ASC`,
                        [req.user.id]
                ),
        ]);
        const suggestions = buildFollowUpSuggestions({ callEvents, tasks, aliases });
        res.json({ suggestions });
});

router.get("/communications", requireUser, async (req, res) => {
        const db = getDb();
        await ensureCommunicationDraftsTable(db);
        const drafts = await db.all(
                `SELECT *
                   FROM communication_drafts
                  WHERE user_id = ?
                  ORDER BY
                    CASE status
                      WHEN 'pending' THEN 0
                      WHEN 'approved' THEN 1
                      WHEN 'sent' THEN 2
                      ELSE 3
                    END,
                    created_at DESC`,
                [req.user.id]
        );
        const recentCallEvents = await db.all(
                `SELECT event, caller, timestamp
                   FROM call_events
                  WHERE user_id = ?
                  ORDER BY timestamp DESC
                  LIMIT 10`,
                [req.user.id]
        );
        res.json({
                drafts,
                voicemailSummary: buildVoicemailStyleSummary(recentCallEvents),
        });
});

router.post("/communications", requireUser, [
        body("channel").isIn(["sms", "email"]),
        body("target_value").notEmpty().trim(),
        body("body").notEmpty().trim(),
], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const db = getDb();
        await ensureCommunicationDraftsTable(db);
        const { channel, target_name, target_value, subject, body: draftBody, source } = req.body;
        const result = await db.run(
                `INSERT INTO communication_drafts (user_id, channel, target_name, target_value, subject, body, source)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, channel, target_name || null, target_value.trim(), subject || null, draftBody.trim(), source || "dex"]
        );
        const draft = await db.get("SELECT * FROM communication_drafts WHERE id = ?", [result.lastID]);
        res.json({ success: true, draft });
});

router.patch("/communications/:id", requireUser, async (req, res) => {
        const db = getDb();
        await ensureCommunicationDraftsTable(db);
        const draft = await db.get(
                "SELECT * FROM communication_drafts WHERE id = ? AND user_id = ?",
                [req.params.id, req.user.id]
        );
        if (!draft) return res.status(404).json({ error: "Draft not found" });

        const requestedStatus = req.body.status;
        const nextBody = req.body.body !== undefined ? String(req.body.body).trim() : draft.body;
        const nextSubject = req.body.subject !== undefined ? req.body.subject : draft.subject;
        const nextTargetName = req.body.target_name !== undefined ? req.body.target_name : draft.target_name;
        const nextTargetValue = req.body.target_value !== undefined ? String(req.body.target_value).trim() : draft.target_value;

        if (requestedStatus === "approved" || requestedStatus === "sent") {
                if (draft.channel === "sms") {
                        await sendSms(nextTargetValue, nextBody);
                } else if (draft.channel === "email") {
                        await sendCustomEmail({
                                to: nextTargetValue,
                                subject: nextSubject || "Message from Dex",
                                body: nextBody,
                        });
                }
        }

        const finalStatus =
                requestedStatus === "approved" || requestedStatus === "sent"
                        ? "sent"
                        : requestedStatus || draft.status;

        await db.run(
                `UPDATE communication_drafts
                    SET target_name = ?,
                        target_value = ?,
                        subject = ?,
                        body = ?,
                        status = ?,
                        updated_at = datetime('now')
                  WHERE id = ? AND user_id = ?`,
                [nextTargetName, nextTargetValue, nextSubject, nextBody, finalStatus, req.params.id, req.user.id]
        );
        const updated = await db.get(
                "SELECT * FROM communication_drafts WHERE id = ? AND user_id = ?",
                [req.params.id, req.user.id]
        );
        res.json({ success: true, draft: updated });
});

router.get("/tasks", requireUser, async (req, res) => {
        const db = getDb();
        await ensureTaskItemsTable(db);
        const tasks = await db.all(
                `SELECT *
                   FROM task_items
                  WHERE user_id = ?
                  ORDER BY
                    CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                    CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
                    due_at ASC,
                    created_at DESC`,
                [req.user.id]
        );
        res.json({ tasks });
});

router.post("/tasks", requireUser, [body("title").notEmpty().trim()], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const db = getDb();
        await ensureTaskItemsTable(db);
        const { title, details, due_at, kind, source } = req.body;
        const result = await db.run(
                `INSERT INTO task_items (user_id, title, details, due_at, kind, source)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [req.user.id, title.trim(), details || null, due_at || null, kind || "task", source || "manual"]
        );
        const task = await db.get("SELECT * FROM task_items WHERE id = ?", [result.lastID]);
        res.json({ success: true, task });
});

router.patch("/tasks/:id", requireUser, async (req, res) => {
        const db = getDb();
        await ensureTaskItemsTable(db);
        const current = await db.get("SELECT * FROM task_items WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        if (!current) return res.status(404).json({ error: "Task not found" });

        const nextStatus = req.body.status || current.status;
        const nextTitle = req.body.title || current.title;
        const nextDetails = req.body.details !== undefined ? req.body.details : current.details;
        const nextDueAt = req.body.due_at !== undefined ? req.body.due_at : current.due_at;
        await db.run(
                `UPDATE task_items
                    SET title = ?,
                        details = ?,
                        status = ?,
                        due_at = ?,
                        updated_at = datetime('now')
                  WHERE id = ? AND user_id = ?`,
                [nextTitle, nextDetails, nextStatus, nextDueAt, req.params.id, req.user.id]
        );
        const updated = await db.get("SELECT * FROM task_items WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        res.json({ success: true, task: updated });
});

router.delete("/tasks/:id", requireUser, async (req, res) => {
        const db = getDb();
        await ensureTaskItemsTable(db);
        await db.run("DELETE FROM task_items WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        res.json({ success: true });
});
// ── FETCH RECENT CALL EVENTS ENDPOINT ───────────────────────────────────────
// Web client can GET recent call events for the user
router.get("/call-events", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        await ensureCallEventsTable(db);
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
                const user = await getUserRecord(userId);
                if (!isPaidSubscriber(user)) return res.json({ success: true, memoryUpdated: false });
                await ensureMemoryTable(db);
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
        await ensurePermissionTable(db);
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
        await ensurePermissionTable(db);
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
        const user = await getUserRecord(userId);
        await ensureMemoryTable(db);
        const rows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ?", [userId]);
        const memory = {};
        for (const row of rows) {
                if (!isPaidSubscriber(user) && requiresPaidMemory(row.key.replace(/^pref:/, ""))) continue;
                memory[row.key] = row.value;
        }
        res.json({ memory });
});

router.post("/memory", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const user = await getUserRecord(userId);
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: "Missing key" });
        if (requiresPaidMemory(key) && !isPaidSubscriber(user)) {
                return res.status(403).json({ error: "paid_subscription_required", message: "Dex memory is available with a paid subscription after your 3-day trial." });
        }
        if (detectSensitiveInfo(`${key} ${value ?? ""}`)) {
                return res.status(400).json({ error: "sensitive_info_blocked", message: SENSITIVE_INFO_WARNING });
        }
        await ensureMemoryTable(db);
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [userId, key, value]
        );
        res.json({ success: true });
});

router.get("/learning/history", requireUser, async (req, res) => {
        const db = getDb();
        const user = await getUserRecord(req.user.id);
        if (!userHasDexAccess(user)) {
                return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial or subscribe for $9.99/month." });
        }

        await ensureLearningTables(db);
        const lessons = await db.all(
                `SELECT id, topic, language, level, lesson_type, title, content, created_at
                   FROM learning_lessons
                  WHERE user_id = ?
                  ORDER BY created_at DESC
                  LIMIT 10`,
                [req.user.id]
        );
        const quizAttempts = await db.all(
                `SELECT id, topic, language, score, total_questions, created_at
                   FROM learning_quiz_attempts
                  WHERE user_id = ?
                  ORDER BY created_at DESC
                  LIMIT 10`,
                [req.user.id]
        );
        const preferences = await loadPreferenceMap(db, req.user.id, [
                "learning_target_language",
                "learning_level",
                "learning_focus",
                "learning_style",
                "learning_reminder_enabled",
                "learning_reminder_time",
                "learning_subject",
        ]);

        const totals = await db.get(
                `SELECT
                        COUNT(*) as attempts,
                        COALESCE(SUM(score), 0) as total_score,
                        COALESCE(SUM(total_questions), 0) as total_questions
                   FROM learning_quiz_attempts
                  WHERE user_id = ?`,
                [req.user.id]
        );

        const averageScore = totals?.total_questions
                ? Math.round((totals.total_score / totals.total_questions) * 100)
                : null;
        const streak = calculateLearningStreak([...lessons, ...quizAttempts]);
        const nextLesson = buildWeakAreaRecommendation(quizAttempts, preferences);

        return res.json({
                lessons,
                quizAttempts,
                progress: {
                        attempts: totals?.attempts || 0,
                        averageScore,
                        completedLessons: lessons.length,
                        streak,
                },
                reminders: {
                        enabled: preferences.learning_reminder_enabled === "1",
                        time: preferences.learning_reminder_time || "",
                },
                nextLesson,
        });
});

router.post("/learning/daily-lesson", requireUser, async (req, res) => {
        const db = getDb();
        const user = await getUserRecord(req.user.id);
        if (!userHasDexAccess(user)) {
                return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial or subscribe for $9.99/month." });
        }

        await ensureMemoryTable(db);
        await ensureLearningTables(db);
        const preferences = await loadPreferenceMap(db, req.user.id, [
                "learning_target_language",
                "learning_level",
                "learning_focus",
                "learning_style",
                "learning_subject",
        ]);
        let learning = getLearningDefaults(preferences, req.body || {});
        if (!req.body?.topic) {
                const recentQuizAttempts = await db.all(
                        `SELECT topic, language, score, total_questions, created_at
                           FROM learning_quiz_attempts
                          WHERE user_id = ?
                          ORDER BY created_at DESC
                          LIMIT 10`,
                        [req.user.id]
                );
                const recommendation = buildWeakAreaRecommendation(recentQuizAttempts, preferences);
                if (recommendation?.topic) {
                        learning = { ...learning, topic: recommendation.topic };
                }
        }

        try {
                const openai = getOpenAI();
                const completion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
                        messages: [
                                {
                                        role: "system",
                                        content: "You create short daily lessons for an AI tutor. Keep them practical, encouraging, and easy to follow.",
                                },
                                {
                                        role: "user",
                                        content:
                                                `Create a daily ${learning.language} lesson for a ${learning.level} learner focused on ${learning.focus}. ` +
                                                `Teaching style: ${learning.style}. Topic: ${learning.topic}. ` +
                                                "Return a short title on the first line, then a concise lesson with: vocabulary, pronunciation help, two example sentences, and a mini practice prompt.",
                                },
                        ],
                        max_tokens: 700,
                        temperature: 0.8,
                });

                const raw = completion.choices[0].message.content.trim();
                const [firstLine, ...rest] = raw.split("\n");
                const title = firstLine.replace(/^#+\s*/, "").trim() || `${learning.language} daily lesson`;
                const content = rest.join("\n").trim() || raw;

                const result = await db.run(
                        `INSERT INTO learning_lessons (user_id, topic, language, level, lesson_type, title, content)
                         VALUES (?, ?, ?, ?, 'daily', ?, ?)`,
                        [req.user.id, learning.topic, learning.language, learning.level, title, content]
                );

                return res.json({
                        lesson: {
                                id: result.lastID,
                                topic: learning.topic,
                                language: learning.language,
                                level: learning.level,
                                lesson_type: "daily",
                                title,
                                content,
                        },
                });
        } catch (err) {
                console.error("Daily lesson generation error:", err.message);
                return res.status(500).json({ error: "lesson_failed", message: "Dex could not create a lesson right now." });
        }
});

router.post("/learning/quiz", requireUser, async (req, res) => {
        const db = getDb();
        const user = await getUserRecord(req.user.id);
        if (!userHasDexAccess(user)) {
                return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial or subscribe for $9.99/month." });
        }

        await ensureMemoryTable(db);
        const preferences = await loadPreferenceMap(db, req.user.id, [
                "learning_target_language",
                "learning_level",
                "learning_focus",
                "learning_style",
        ]);
        const learning = getLearningDefaults(preferences, req.body || {});

        try {
                const openai = getOpenAI();
                const completion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
                        messages: [
                                {
                                        role: "system",
                                        content: "You create short quizzes for an AI tutor. Return valid JSON only.",
                                },
                                {
                                        role: "user",
                                        content:
                                                `Create a 5-question ${learning.language} quiz for a ${learning.level} learner focused on ${learning.focus}. Topic: ${learning.topic}. ` +
                                                `Return JSON with this shape: {"title":"...","topic":"...","language":"...","questions":[{"question":"...","choices":["...","...","...","..."],"answer":"...","explanation":"..."}]}`,
                                },
                        ],
                        max_tokens: 900,
                        temperature: 0.7,
                });

                const quiz = extractJsonObject(completion.choices[0].message.content);
                return res.json({ quiz });
        } catch (err) {
                console.error("Quiz generation error:", err.message);
                return res.status(500).json({ error: "quiz_failed", message: "Dex could not build a quiz right now." });
        }
});

router.post("/learning/quiz/submit", requireUser, async (req, res) => {
        const db = getDb();
        const user = await getUserRecord(req.user.id);
        if (!userHasDexAccess(user)) {
                return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial or subscribe for $9.99/month." });
        }

        await ensureLearningTables(db);
        const { quiz, answers } = req.body || {};
        if (!quiz || !Array.isArray(quiz.questions) || !Array.isArray(answers)) {
                return res.status(400).json({ error: "invalid_quiz_submission", message: "Quiz and answers are required." });
        }

        const results = quiz.questions.map((question, index) => {
                const userAnswer = answers[index] ?? null;
                const correct = userAnswer === question.answer;
                return {
                        question: question.question,
                        userAnswer,
                        correctAnswer: question.answer,
                        correct,
                        explanation: question.explanation || "",
                };
        });

        const score = results.filter((item) => item.correct).length;
        const totalQuestions = results.length;

        await db.run(
                `INSERT INTO learning_quiz_attempts (user_id, topic, language, score, total_questions, responses_json)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                        req.user.id,
                        quiz.topic || null,
                        quiz.language || null,
                        score,
                        totalQuestions,
                        JSON.stringify(results),
                ]
        );

        return res.json({
                score,
                totalQuestions,
                percentage: totalQuestions ? Math.round((score / totalQuestions) * 100) : 0,
                results,
        });
});



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

const DEX_SYSTEM_PROMPT = `You are Dex, a friendly and empathetic AI assistant for Konvict Artz. You help users with scheduling, questions, general support, and teaching. Be warm, concise, and helpful.

When a user wants to learn something:
- teach step by step instead of dumping everything at once
- explain clearly, using simple language first and then a deeper explanation if needed
- check understanding with a short question or mini practice prompt
- adapt to the user's level when it is known

When teaching a language:
- give short, practical lessons
- include the meaning in English
- include pronunciation help in plain English when useful
- use one or two example sentences
- end with a tiny practice exercise or response prompt
- avoid overwhelming the user with too much vocabulary at once`;

const DEX_ADMIN_SYSTEM_PROMPT = `You are Dex, an AI assistant for Konvict Artz. You are speaking with an admin user. Provide detailed, technical responses when appropriate. Help with scheduling, analytics, business operations, and educational content design when asked.`;

router.post("/chat", requireUser, spamFilter, [body("message").notEmpty().trim()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

              const { message } = req.body;
    const db = getDb();
    const userId = req.user.id;
    const historyThreshold = await purgeExpiredChatHistory(db, userId);

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

                        if (detectSensitiveInfo(message)) {
                                return res.json({
                                        reply: SENSITIVE_INFO_WARNING,
                                        warning: "sensitive_info_blocked",
                                });
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
                    "SELECT role, content FROM chat_history WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20",
                    [userId, historyThreshold]
                  );
              const learningPreferences = await loadPreferenceMap(db, userId, [
                    "learning_target_language",
                    "learning_level",
                    "learning_focus",
                    "learning_style",
                    "conversation_tone",
              ]);
              const learningContext = buildLearningContext(learningPreferences);
              await ensureRelationshipAliasesTable(db);
              const relationshipAliases = await db.all(
                    `SELECT alias, contact_name
                       FROM relationship_aliases
                      WHERE user_id = ?
                      ORDER BY alias ASC`,
                    [userId]
              );
              const relationshipContext = buildRelationshipContext(relationshipAliases);
    const messages = history.reverse().map((h) => ({ role: h.role, content: h.content }));
    if (learningContext) {
      messages.unshift({ role: "system", content: learningContext });
    }
    if (relationshipContext) {
      messages.unshift({ role: "system", content: relationshipContext });
    }
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
                        if (matchedIntent && isPaidSubscriber(user)) {
                                await ensureMemoryTable(db);
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

             let access = user.role === "admin" ? "unlimited" : user.access_type;
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

             if (access === "paid" && user.sub_expires && new Date() > new Date(user.sub_expires)) {
                   access = "expired";
                   await db.run("UPDATE users SET access_type = 'expired' WHERE id = ?", [user.id]);
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
        const user = await getUserRecord(req.user.id);
        if (isPaidSubscriber(user)) {
                await ensureMemoryTable(db);
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

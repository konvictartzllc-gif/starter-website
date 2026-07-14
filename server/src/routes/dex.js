import { Router } from "express";
import { body, validationResult } from "express-validator";
import { requireUser, optionalUser } from "../middleware/auth.js";
import { getDb } from "../db.js";
import { getAIClient, getAIStatus } from "../services/ai.js";
import { triggerEmergencyAlert, sendSms } from "../services/communications.js";
import {
        PROVIDER_TWILIO_VOICE,
        getUserIntegrationRoutes,
        upsertUserIntegrationRoute,
        normalizePhoneNumber,
} from "../services/integrations.js";
import { createEvent, listEvents } from "../services/calendar.js";
import { verifyOta, spamFilter } from "../middleware/security.js";
import { sendCustomEmail } from "../services/email.js";
import { detectTone } from "../services/toneDetection.js";
import { getToneInstruction, styleResponse } from "../services/responseStyler.js";
import { buildSupportReply, detectSafetySignal } from "../services/safetySignals.js";
import { dexIntentEngine } from "../services/dexIntentEngine.js";
import { getPublicApiBaseUrl } from "../deploy.js";
import { scheduleAppointmentNotifications } from "../services/notificationScheduler.js";
const router = Router();

const CHAT_MEMORY_RETENTION_DAYS = 3;
const SENSITIVE_INFO_WARNING =
        "I won't save sensitive information like bank details, card numbers, passwords, or Social Security numbers. Please remove that information and try again.";
const WORKFLOW_PREFIX = "pref:workflow:";
const WEB_SEARCH_TIMEOUT_MS = 5500;
const DEX_SHOP_ITEMS = [
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

function normalizeEmergencyContactTarget(target) {
        const value = String(target || "").trim();
        if (!value) return "";
        if (value.includes("@")) return value;
        const digits = value.replace(/\D/g, "");
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
        if (value.startsWith("+") && digits.length >= 10) return `+${digits}`;
        return value;
}

function isTruthyPreference(value) {
        return ["1", "true", "yes", "on", "enabled"].includes(String(value || "").trim().toLowerCase());
}

function isEmergencyContactAlertRequest(message = "") {
        const text = String(message || "").trim();
        if (!text) return false;
        return (
                /\b(send|trigger|start)\b.*\bemergency alert\b/i.test(text) ||
                /\b(alert|notify|text|message|call|contact|tell)\b.*\b(my )?(emergency|trusted)\b.*\b(contact|person|support)\b/i.test(text) ||
                /\b(my )?(emergency|trusted)\b.*\b(contact|person)\b.*\b(now|help|alert|notify|message|text|call)\b/i.test(text)
        );
}

function extractWebRequest(message = "") {
        const text = String(message || "").trim();
        const cleanedMediaQuery = (value = "") => String(value || "")
                .replace(/^.*?\b(?:and\s+)?(?:play|run|start)\b/i, "")
                .replace(/\b(?:on\s+)?(?:youtube|yt|music|song|video)\b/ig, " ")
                .replace(/\b(?:please|for me|right now|now)\b/ig, " ")
                .replace(/^(?:the\s+)?app\s+and\s+/i, "")
                .replace(/^(?:and\s+)?(?:open|play|run|start)\s+/i, "")
                .replace(/\s+/g, " ")
                .trim();
        const mediaMatch =
                text.match(/\b(?:play|run|start)\s+(?:the\s+)?(?:song|track|music|video)?\s*(.+)/i) ||
                text.match(/\b(?:open|pull up)\s+(.+?)\s+(?:on\s+)?(?:youtube|yt)\b/i);
        const mediaQuery = cleanedMediaQuery(mediaMatch?.[1]);
        if (mediaQuery && !/^(?:a\s+)?(?:game|games|riddle|trivia|quiz)$/i.test(mediaQuery)) {
                return { type: "youtube", query: mediaQuery, autoOpen: true, intent: "play" };
        }
        const youtubeMatch = text.match(/\b(?:search|look up|find|pull up|open)\s+(?:on\s+)?youtube\s+(?:for\s+)?(.+)/i);
        if (youtubeMatch?.[1]) {
                return { type: "youtube", query: youtubeMatch[1].trim(), autoOpen: /\b(open|pull up)\b/i.test(text) };
        }
        if (/\b(open|pull up)\s+youtube\b/i.test(text)) {
                return { type: "youtube", query: "", autoOpen: true };
        }
        const webMatch =
                text.match(/\b(?:search|look up|google|find)\s+(?:the\s+web\s+)?(?:for\s+)?(.+)/i) ||
                text.match(/\b(?:what is|who is|where is|when is|how do i|how to)\s+(.+)/i);
        if (webMatch?.[0] && /\b(search|look up|google|find|latest|today|current|youtube)\b/i.test(text)) {
                return { type: "web", query: (webMatch[1] || text).trim() };
        }
        return null;
}

function withTimeout(promise, timeoutMs = WEB_SEARCH_TIMEOUT_MS) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        return Promise.resolve(promise(controller.signal)).finally(() => clearTimeout(timeout));
}

function stripHtml(value = "") {
        return String(value)
                .replace(/<[^>]+>/g, " ")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, "&")
                .replace(/\s+/g, " ")
                .trim();
}

async function fetchDuckDuckGoInstantAnswer(query) {
        const url = new URL("https://api.duckduckgo.com/");
        url.searchParams.set("q", query);
        url.searchParams.set("format", "json");
        url.searchParams.set("no_html", "1");
        url.searchParams.set("skip_disambig", "1");
        return withTimeout(async (signal) => {
                const response = await fetch(url, { signal });
                if (!response.ok) throw new Error(`Web search failed: ${response.status}`);
                return response.json();
        });
}

function buildSearchReply(request, searchData = null) {
        const query = request.query || "YouTube";
        if (request.type === "youtube") {
                const url = request.query
                        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(request.query)}`
                        : "https://www.youtube.com";
                return {
                        reply: request.query
                                ? `${request.intent === "play" ? "Opening" : "I can open"} YouTube for "${request.query}": ${url}`
                                : "Opening YouTube.",
                        webAction: {
                                type: "youtube",
                                query: request.query,
                                url,
                                autoOpen: Boolean(request.autoOpen),
                                intent: request.intent || "open",
                        },
                };
        }

        const abstract = stripHtml(searchData?.AbstractText || searchData?.Answer || "");
        const heading = stripHtml(searchData?.Heading || query);
        const related = Array.isArray(searchData?.RelatedTopics)
                ? searchData.RelatedTopics
                        .flatMap((item) => Array.isArray(item.Topics) ? item.Topics : [item])
                        .filter((item) => item?.Text && item?.FirstURL)
                        .slice(0, 3)
                : [];
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
        const lines = [];
        if (abstract) {
                lines.push(`${heading}: ${abstract}`);
        } else {
                lines.push(`I searched for "${query}" and did not get a clean instant answer. Here is a web search link: ${searchUrl}`);
        }
        if (related.length) {
                lines.push("Related links:");
                for (const item of related) {
                        lines.push(`- ${stripHtml(item.Text)}: ${item.FirstURL}`);
                }
        }
        lines.push(`Search more: ${searchUrl}`);
        return {
                reply: lines.join("\n"),
                webAction: { type: "web", query, url: searchUrl, answered: Boolean(abstract), relatedCount: related.length },
        };
}

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
        "notification_phone",
        "comfort_style",
        "grounding_preference",
        "safety_follow_up_opt_in",
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

async function ensureCallMessagesTable(db) {
        await db.run(
                `CREATE TABLE IF NOT EXISTS call_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        caller TEXT,
                        phone_number TEXT,
                        message TEXT NOT NULL,
                        handled INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
                lessonType: body.lessonType || null,
        };
}

const LESSON_TYPE_POOL = [
        "conversation",
        "grammar",
        "culture",
        "pronunciation",
        "storytelling",
        "dialogue",
        "vocabulary",
        "slang",
];

function pickLessonType(lessonType, recentLessonTypes = []) {
        if (lessonType) return lessonType;
        const available = LESSON_TYPE_POOL.filter((t) => !recentLessonTypes.slice(0, 3).includes(t));
        const pool = available.length > 0 ? available : LESSON_TYPE_POOL;
        return pool[Math.floor(Math.random() * pool.length)];
}

function buildLessonPrompt(learning, lessonType) {
        const typeInstructions = {
                conversation: `Write a conversational lesson. Focus on common phrases used in real everyday exchanges. Include a realistic back-and-forth dialogue snippet and a practice prompt where the learner responds to a question.`,
                grammar: `Write a grammar-focused lesson. Explain one grammar rule clearly, show the pattern, give contrasting examples (right vs wrong), and end with a fill-in practice sentence.`,
                culture: `Write a culture lesson. Share an interesting cultural fact, tradition, or social custom tied to the language. Connect vocabulary or phrases to cultural context. Make it feel like a story.`,
                pronunciation: `Write a pronunciation lesson. Focus on 2-3 tricky sounds. Use sound-it-out phonetics in parentheses after every word (e.g. hola = oh-lah). Include a tongue exercise or rhythm tip.`,
                storytelling: `Write a mini-story lesson (4-6 sentences) told entirely in ${learning.language} with an interlinear English translation below each sentence. Choose a fun, relatable scenario.`,
                dialogue: `Write a lesson built around a realistic two-person dialogue (at least 6 lines). Label speakers A and B. Add vocabulary notes below and a role-play challenge at the end.`,
                vocabulary: `Write a vocabulary-themed lesson. Teach 6-8 related words grouped by theme. For each word give pronunciation, part of speech, and one example sentence.`,
                slang: `Write a lesson on everyday slang, idioms, or colloquial expressions for ${learning.language}. Explain what each phrase literally means versus what it actually means in conversation.`,
        };
        const typeGuide = typeInstructions[lessonType] || typeInstructions.conversation;
        return (
                `Create a ${learning.language} lesson for a ${learning.level} learner. ` +
                `Lesson type: ${lessonType}. Focus area: ${learning.focus}. Topic: ${learning.topic}. Teaching style: ${learning.style}. ` +
                typeGuide +
                ` For any pronunciation guides, always write phonetics in parentheses after the word — never spell letter by letter. ` +
                `Return a short punchy title on the first line, then the lesson body. Keep the whole response under 600 words.`
        );
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
        const todayKey = now.toISOString().slice(0, 10);
        const monthDay = todayKey.slice(5);

        // Ensure special_days table exists (best-effort — may not exist on first run)
        try {
                await db.run(`CREATE TABLE IF NOT EXISTS special_days (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                        title TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'reminder',
                        recur_yearly INTEGER NOT NULL DEFAULT 0, notes TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`);
        } catch {}

        const [appointments, tasks, callEvents, aliases, preferences, lessons, quizAttempts, specialDays] = await Promise.all([
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
                db.all(
                        `SELECT * FROM special_days
                          WHERE user_id = ?
                            AND (date = ? OR (recur_yearly = 1 AND substr(date,6) = ?))
                          ORDER BY date ASC`,
                        [userId, todayKey, monthDay]
                ).catch(() => []),
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
	if (specialDays.length) {
		for (const sd of specialDays) {
			const kindLabel = sd.kind === "birthday" ? "🎂 Birthday" :
				sd.kind === "anniversary" ? "💍 Anniversary" :
				sd.kind === "holiday" ? "🎉 Holiday" : "📌 Reminder";
			highlights.push(`${kindLabel}: ${sd.title} is today!`);
		}
	}
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
                specialDays,
                tone: preferences.conversation_tone || "balanced",
                latestLesson: lessons[0] || null,
        };
}

async function purgeExpiredChatHistory(db, userId) {
        const threshold = new Date(Date.now() - CHAT_MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        await db.run("DELETE FROM chat_history WHERE user_id = ? AND created_at < ?", [userId, threshold]);
        return threshold;
}

// â”€â”€ LEARNED PREFERENCES ENDPOINTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

router.get("/workflows", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const user = await getUserRecord(userId);
        if (!isPaidSubscriber(user)) {
                return res.status(403).json({ error: "paid_subscription_required", message: "Dex self-learning workflows are available with paid or unlimited Dex memory." });
        }
        const workflows = await loadLearnedWorkflows(db, userId, 50);
        return res.json({ workflows });
});

router.post("/workflows", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const user = await getUserRecord(userId);
        if (!isPaidSubscriber(user)) {
                return res.status(403).json({ error: "paid_subscription_required", message: "Dex self-learning workflows are available with paid or unlimited Dex memory." });
        }

        const title = String(req.body?.title || "").trim();
        const trigger = String(req.body?.trigger || title).trim();
        const steps = String(req.body?.steps || "").trim();
        if (!title || !steps) {
                return res.status(400).json({ error: "missing_workflow", message: "A workflow title and steps are required." });
        }
        if (detectSensitiveInfo(`${title} ${trigger} ${steps}`)) {
                return res.status(400).json({ error: "sensitive_info_blocked", message: SENSITIVE_INFO_WARNING });
        }

        await ensureMemoryTable(db);
        const workflow = await saveLearnedWorkflow(db, userId, { title, trigger, steps });
        return res.json({ success: true, workflow });
});

router.get("/shop", requireUser, async (req, res) => {
        const db = getDb();
        const state = await getShopState(db, req.user.id);
        return res.json(state);
});

router.post("/shop/reward", requireUser, async (req, res) => {
        const db = getDb();
        const won = Boolean(req.body?.won);
        if (!won) return res.json(await getShopState(db, req.user.id));
        const coins = await addDexCoins(db, req.user.id, 5);
        return res.json({ ...(await getShopState(db, req.user.id)), coins, awarded: 5 });
});

router.post("/shop/purchase", requireUser, async (req, res) => {
        const db = getDb();
        const item = DEX_SHOP_ITEMS.find((entry) => entry.id === req.body?.itemId);
        if (!item) return res.status(404).json({ error: "item_not_found", message: "Dex could not find that shop item." });
        const state = await getShopState(db, req.user.id);
        if (state.owned[item.id]) {
                const equipped = { ...state.equipped, [item.slot]: item.id };
                await setMemoryValue(db, req.user.id, "dex_equipped", JSON.stringify(equipped));
                return res.json({ ...(await getShopState(db, req.user.id)), equipped });
        }
        if (state.coins < item.price) {
                return res.status(400).json({ error: "not_enough_coins", message: "Not enough coins yet. Win games or buy a coin pack." });
        }
        await setMemoryValue(db, req.user.id, "dex_coins", state.coins - item.price);
        await setMemoryValue(db, req.user.id, `dex_owned:${item.id}`, "1");
        const equipped = { ...state.equipped, [item.slot]: item.id };
        await setMemoryValue(db, req.user.id, "dex_equipped", JSON.stringify(equipped));
        return res.json(await getShopState(db, req.user.id));
});

router.post("/shop/colors", requireUser, async (req, res) => {
        const db = getDb();
        const colors = normalizeDexColors(req.body?.colors || req.body || {});
        await setMemoryValue(db, req.user.id, "dex_colors", JSON.stringify(colors));
        return res.json({ ...(await getShopState(db, req.user.id)), colors });
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
        await ensureCallMessagesTable(db);
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
        const callMessages = await db.all(
                `SELECT id, caller, phone_number, message, handled, created_at
                   FROM call_messages
                  WHERE user_id = ?
                  ORDER BY handled ASC, created_at DESC
                  LIMIT 20`,
                [req.user.id]
        );
        res.json({
                drafts,
                callMessages,
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
// â”€â”€ FETCH RECENT CALL EVENTS ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
// â”€â”€ ANDROID CALL EVENT ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Android app can POST call events (incoming, answered, declined)
router.post("/call-event", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const { event, caller, timestamp, message, phoneNumber } = req.body;
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

        if (event === "message") {
                const parsed = parseCallerMessage({ caller, message });
                if (parsed.message) {
                        await ensureCallMessagesTable(db);
                        await db.run(
                                `INSERT INTO call_messages (user_id, caller, phone_number, message)
                                 VALUES (?, ?, ?, ?)`,
                                [userId, parsed.caller, phoneNumber || null, parsed.message]
                        );
                        await ensureTaskItemsTable(db);
                        await db.run(
                                `INSERT INTO task_items (user_id, title, details, kind, source)
                                 VALUES (?, ?, ?, 'call_follow_up', 'dex_call_screening')`,
                                [
                                        userId,
                                        `Follow up with ${parsed.caller}`,
                                        `Caller: ${parsed.caller}${phoneNumber ? `\nNumber: ${phoneNumber}` : ""}\nMessage: ${parsed.message}`,
                                ]
                        );
                }
        }

        // â”€â”€ AUTO-LEARN FAVORITE CONTACTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
// â”€â”€ USER PERMISSIONS ENDPOINTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

router.get("/integrations", requireUser, async (req, res) => {
        const db = getDb();
        const routes = await getUserIntegrationRoutes(db, req.user.id);
        const publicApiBaseUrl = getPublicApiBaseUrl();
        res.json({
                integrations: routes.map((route) => ({
                        id: route.id,
                        provider: route.provider,
                        accountLabel: route.account_label || "Shared account",
                        sharedAccount: Boolean(route.account_shared),
                        routeKey: route.route_key,
                        assignedNumber: route.assigned_number,
                        extension: route.extension,
                        permissions: route.permissions_json ? JSON.parse(route.permissions_json) : {},
                        enabled: Boolean(route.enabled),
                        webhookUrl: `${publicApiBaseUrl}/api/twilio/voice?token=YOUR_WEBHOOK_TOKEN&route=${route.route_key}`,
                })),
        });
});

router.post("/integrations/voice", requireUser, async (req, res) => {
        const db = getDb();
        const userId = req.user.id;
        const publicApiBaseUrl = getPublicApiBaseUrl();
        const row = await db.get("SELECT permissions FROM user_permissions WHERE user_id = ?", [userId]);
        let permissions = {};
        if (row?.permissions) {
                try { permissions = JSON.parse(row.permissions); } catch {}
        }
        if (!permissions.phone) {
                return res.status(403).json({ error: "phone_permission_required", message: "Enable phone permission before connecting a call route." });
        }

        const assignedNumber = normalizePhoneNumber(req.body.assignedNumber);
        const extension = String(req.body.extension || "").trim();
        const route = await upsertUserIntegrationRoute(db, {
                userId,
                provider: PROVIDER_TWILIO_VOICE,
                assignedNumber,
                extension,
                permissions: {
                        answerCalls: true,
                        takeMessages: true,
                        sendSms: Boolean(permissions.notifications),
                },
                enabled: req.body.enabled !== false,
        });
        res.json({
                success: true,
                integration: {
                        id: route.id,
                        provider: route.provider,
                        routeKey: route.route_key,
                        assignedNumber: route.assigned_number,
                        extension: route.extension,
                        enabled: Boolean(route.enabled),
                        webhookUrl: `${publicApiBaseUrl}/api/twilio/voice?token=YOUR_WEBHOOK_TOKEN&route=${route.route_key}`,
                },
        });
});
// â”€â”€ USER MEMORY ENDPOINTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        const recentLessonTypes = await db.all(
                `SELECT lesson_type FROM learning_lessons WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
                [req.user.id]
        );
        const chosenLessonType = pickLessonType(learning.lessonType, recentLessonTypes.map((l) => l.lesson_type));

        try {
                const openai = getOpenAI();
                const completion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
                        messages: [
                                {
                                        role: "system",
                                        content: "You are Dex, a warm and encouraging language tutor. Write lessons that feel personal, practical, and fun — like a real tutor talking to a student, not a textbook.",
                                },
                                {
                                        role: "user",
                                        content: buildLessonPrompt(learning, chosenLessonType),
                                },
                        ],
                        max_tokens: 750,
                        temperature: 0.85,
                });

                const raw = completion.choices[0].message.content.trim();
                const [firstLine, ...rest] = raw.split("\n");
                const title = firstLine.replace(/^#+\s*/, "").trim() || `${learning.language} daily lesson`;
                const content = rest.join("\n").trim() || raw;

                const result = await db.run(
                        `INSERT INTO learning_lessons (user_id, topic, language, level, lesson_type, title, content)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [req.user.id, learning.topic, learning.language, learning.level, chosenLessonType, title, content]
                );

                return res.json({
                        lesson: {
                                id: result.lastID,
                                topic: learning.topic,
                                language: learning.language,
                                level: learning.level,
                                lesson_type: chosenLessonType,
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
        await ensureLearningTables(db);
        const preferences = await loadPreferenceMap(db, req.user.id, [
                "learning_target_language",
                "learning_level",
                "learning_focus",
                "learning_style",
        ]);
        let learning = getLearningDefaults(preferences, req.body || {});
        const latestLesson = await db.get(
                `SELECT title, content, topic, language, level
                   FROM learning_lessons
                  WHERE user_id = ?
                    AND lesson_type = 'daily'
                  ORDER BY created_at DESC
                  LIMIT 1`,
                [req.user.id]
        );

        let lessonContext = "";
        if (latestLesson) {
                learning = {
                        ...learning,
                        topic: req.body?.topic || latestLesson.topic || learning.topic,
                        language: latestLesson.language || learning.language,
                        level: latestLesson.level || learning.level,
                };
                lessonContext = latestLesson.content || "";
        }

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
                                        content: lessonContext
                                                ? `Create a 5-question ${learning.language} quiz for a ${learning.level} learner based only on this lesson content. ` +
                                                  `Focus: ${learning.focus}. Topic: ${learning.topic}. ` +
                                                  `Lesson title: ${latestLesson?.title || learning.topic}. ` +
                                                  `Lesson content:\n${lessonContext}\n\n` +
                                                  `Return JSON with this shape: {"title":"...","topic":"...","language":"...","questions":[{"question":"...","choices":["...","...","...","..."],"answer":"...","explanation":"..."}]}`
                                                : `Create a 5-question ${learning.language} quiz for a ${learning.level} learner focused on ${learning.focus}. Topic: ${learning.topic}. ` +
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

        const normalizeQuizAnswer = (value) =>
                String(value ?? "")
                        .trim()
                        .toLowerCase()
                        .replace(/[^\p{L}\p{N}\s]/gu, "")
                        .replace(/\s+/g, " ");

        const results = quiz.questions.map((question, index) => {
                const userAnswer = answers[index] ?? null;
                const normalizedAnswer = normalizeQuizAnswer(userAnswer);
                const normalizedCorrect = normalizeQuizAnswer(question.answer);
                const correct =
                        normalizedAnswer === normalizedCorrect ||
                        normalizedAnswer === normalizeQuizAnswer(String(question.correctOption ?? ""));
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
    const status = getAIStatus();
    if (!status.ready) {
        const error = new Error(
                status.reason === "missing_api_key"
                        ? "AI provider is not configured. Add OPENAI_API_KEY to server/.env or choose a configured AI_PROVIDER."
                        : "AI provider is not ready."
        );
        error.statusCode = 503;
        error.code = status.reason || "ai_not_ready";
        throw error;
    }
    return getAIClient();
}

async function getShopState(db, userId) {
        await ensureMemoryTable(db);
        const rows = await db.all(
                "SELECT key, value FROM user_memory WHERE user_id = ? AND (key = 'dex_coins' OR key = 'dex_equipped' OR key = 'dex_colors' OR key LIKE 'dex_owned:%')",
                [userId]
        );
        const owned = {};
        let coins = 0;
        let equipped = {};
        let colors = defaultDexColors();
        for (const row of rows) {
                if (row.key === "dex_coins") coins = parseInt(row.value || "0", 10) || 0;
                if (row.key === "dex_equipped") {
                        try { equipped = JSON.parse(row.value || "{}"); } catch {}
                }
                if (row.key === "dex_colors") {
                        try { colors = normalizeDexColors(JSON.parse(row.value || "{}")); } catch {}
                }
                if (row.key.startsWith("dex_owned:")) owned[row.key.replace("dex_owned:", "")] = true;
        }
        return { coins, owned, equipped, colors, items: DEX_SHOP_ITEMS };
}

function defaultDexColors() {
        return {
                bodyPrimary: "#dbeafe",
                bodySecondary: "#8b5cf6",
                face: "#070817",
                accent: "#a78bfa",
                hatPrimary: "#22d3ee",
                hatSecondary: "#facc15",
        };
}

function parseCallerMessage({ caller, message }) {
        const explicitMessage = String(message || "").trim();
        const rawCaller = String(caller || "").trim();
        if (explicitMessage) {
                return { caller: rawCaller || "Unknown caller", message: explicitMessage };
        }
        const match = rawCaller.match(/^([^:]{1,120}):\s*([\s\S]+)$/);
        if (match) {
                return {
                        caller: match[1].trim() || "Unknown caller",
                        message: match[2].trim(),
                };
        }
        return { caller: rawCaller || "Unknown caller", message: "" };
}

function normalizeDexColors(input = {}) {
        const defaults = defaultDexColors();
        const colors = {};
        for (const key of Object.keys(defaults)) {
                const value = String(input[key] || defaults[key]).trim();
                colors[key] = /^#[0-9a-f]{6}$/i.test(value) ? value : defaults[key];
        }
        return colors;
}

async function setMemoryValue(db, userId, key, value) {
        await ensureMemoryTable(db);
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [userId, key, String(value)]
        );
}

async function addDexCoins(db, userId, amount) {
        const state = await getShopState(db, userId);
        const coins = Math.max(0, state.coins + amount);
        await setMemoryValue(db, userId, "dex_coins", coins);
        return coins;
}

function slugifyWorkflowTitle(value = "") {
        const slug = String(value)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 48);
        return slug || `workflow-${Date.now()}`;
}

function parseWorkflowValue(row) {
        try {
                const parsed = JSON.parse(row.value || "{}");
                return {
                        id: row.key.replace(WORKFLOW_PREFIX, ""),
                        title: parsed.title || row.key.replace(WORKFLOW_PREFIX, ""),
                        trigger: parsed.trigger || "",
                        steps: parsed.steps || "",
                        createdAt: parsed.createdAt || null,
                        updatedAt: parsed.updatedAt || null,
                };
        } catch {
                return null;
        }
}

async function loadLearnedWorkflows(db, userId, limit = 8) {
        await ensureMemoryTable(db);
        const rows = await db.all(
                `SELECT key, value
                   FROM user_memory
                  WHERE user_id = ?
                    AND key LIKE ?
                  ORDER BY key ASC`,
                [userId, `${WORKFLOW_PREFIX}%`]
        );
        return rows.map(parseWorkflowValue).filter(Boolean).slice(0, limit);
}

function buildWorkflowContext(workflows = []) {
        if (!workflows.length) return null;
        const text = workflows
                .map((workflow) => {
                        const trigger = workflow.trigger ? `Trigger: ${workflow.trigger}. ` : "";
                        return `Workflow "${workflow.title}". ${trigger}Steps: ${workflow.steps}`;
                })
                .join("\n\n");
        return (
                "The user has personally taught Dex these reusable workflows. " +
                "When the user asks for one of these tasks, mimic their saved process and follow these steps before improvising. " +
                "If the workflow requires an outside action you cannot directly complete, explain the next step or draft the output.\n\n" +
                text
        );
}

function extractTaughtWorkflow(message = "") {
        const text = String(message || "").trim();
        const match = text.match(/\b(?:dex\s*,?\s*)?(?:remember|save|learn|teach yourself|teach dex)\s+(?:this\s+)?(?:workflow|process|routine|how\s+i\s+do|how\s+to|to)\s+([^:\n.?!]+)[:\n-]+([\s\S]{20,})$/i);
        if (!match) return null;
        const title = match[1].trim().replace(/^["']|["']$/g, "");
        const steps = match[2].trim();
        if (!title || !steps || detectSensitiveInfo(`${title} ${steps}`)) return null;
        return {
                title,
                trigger: title,
                steps,
        };
}

async function saveLearnedWorkflow(db, userId, workflow) {
        const id = slugifyWorkflowTitle(workflow.title);
        const now = new Date().toISOString();
        const existing = await db.get("SELECT value FROM user_memory WHERE user_id = ? AND key = ?", [userId, `${WORKFLOW_PREFIX}${id}`]);
        let createdAt = now;
        if (existing?.value) {
                try {
                        createdAt = JSON.parse(existing.value).createdAt || now;
                } catch {}
        }
        const value = JSON.stringify({
                title: workflow.title,
                trigger: workflow.trigger || workflow.title,
                steps: workflow.steps,
                createdAt,
                updatedAt: now,
        });
        await db.run(
                `INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
                [userId, `${WORKFLOW_PREFIX}${id}`, value]
        );
        return { id, ...JSON.parse(value) };
}

const DEX_SYSTEM_PROMPT = `You are Dex, a friendly and empathetic AI assistant for Konvict Artz. You help users with scheduling, questions, general support, and teaching. Be warm, concise, and helpful.

Device and web access:
- Do not claim unlimited access. Be honest about permissions, device security, app store rules, browser limits, and third-party service limits.
- If a task needs a permission or external app, explain the exact permission or app connection needed.
- When the user asks to open, play, run, search, or pull up YouTube/web content, use the available open-link flow. Do not say you cannot open it unless the app lacks the needed permission or the browser blocks it.
- If you cannot directly control something on the user's device, offer the next best action and clear setup steps.

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

              const { message, voiceSignals } = req.body;
    const db = getDb();
    const userId = req.user.id;
    const historyThreshold = await purgeExpiredChatHistory(db, userId);

              const user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return res.status(404).json({ error: "User not found" });

              const isAdmin = user.role === "admin";
    let hasAccess = isAdmin;
              const learningPreferences = await loadPreferenceMap(db, userId, [
                    "learning_target_language",
                    "learning_level",
                    "learning_focus",
                    "learning_style",
                    "conversation_tone",
                    "comfort_style",
                    "grounding_preference",
                    "safety_follow_up_opt_in",
              ]);

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

              const dexIntent = dexIntentEngine.classify_intent(message, {
                    detectSensitiveInfo,
                    detectSafetySignal,
                    extractWebRequest,
                    isEmergencyContactAlertRequest,
              });
              const dexParameters = dexIntentEngine.extract_parameters(message, dexIntent, {
                    detectSafetySignal,
                    extractWebRequest,
                    userId,
                    voiceSignals,
              });
              const dexRoute = dexIntentEngine.route_to_action(dexIntent, dexParameters);
              const dexBrain = {
                    intent: dexIntent.key,
                    confidence: dexIntent.confidence,
                    route: dexRoute.name,
                    actionIntent: dexRoute.actionIntent,
              };
              const dexActionResult = await dexIntentEngine.execute_action(dexRoute, dexParameters, {
                    warn_sensitive_info: async () => ({
                            reply: SENSITIVE_INFO_WARNING,
                            warning: "sensitive_info_blocked",
                    }),
                    handle_web_request: async ({ webRequest }) => {
                            try {
                                    const searchData = webRequest.type === "web"
                                            ? await fetchDuckDuckGoInstantAnswer(webRequest.query)
                                            : null;
                                    const webReply = buildSearchReply(webRequest, searchData);
                                    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [userId, message]);
                                    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, webReply.reply]);
                                    return webReply;
                            } catch (error) {
                                    const fallback = webRequest.type === "youtube"
                                            ? buildSearchReply(webRequest)
                                            : {
                                                    reply: `I could not reach live web search right now, but I can still help from what I know. Web search link: https://duckduckgo.com/?q=${encodeURIComponent(webRequest.query)}`,
                                                    webAction: {
                                                            type: "web",
                                                            query: webRequest.query,
                                                            url: `https://duckduckgo.com/?q=${encodeURIComponent(webRequest.query)}`,
                                                            error: error?.message || "search_failed",
                                                    },
                                            };
                                    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [userId, message]);
                                    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, fallback.reply]);
                                    return fallback;
                            }
                    },
              });
              if (dexActionResult) {
                    return res.json({ ...dexActionResult, dexBrain });
              }

                        if (detectSensitiveInfo(message)) {
                                return res.json({
                                        reply: SENSITIVE_INFO_WARNING,
                                        warning: "sensitive_info_blocked",
                                        dexBrain,
                                });
                        }

                        const safetySignal = detectSafetySignal(message);
                        const emergencyContactRequested = isEmergencyContactAlertRequest(message);
                        if (safetySignal.level === "emergency" || emergencyContactRequested) {
                                const userInfo = `${user.name || "Unknown"} (${user.email})`;
                                Promise.resolve(triggerEmergencyAlert(userInfo, message)).catch((error) => {
                                        console.error("Emergency alert error:", error?.message || error);
                                });
                                let reply = "";
                                if (emergencyContactRequested && safetySignal.level !== "emergency") {
                                        reply = "I am treating this as an emergency contact request. If you are in immediate danger, call 911 or your local emergency number right now.";
                                } else if (safetySignal.type === "self_harm") {
                                        reply = "Hey, I hear you and I want you to know you matter. Please reach out to the 988 Suicide & Crisis Lifeline by calling or texting 988 right now. If you are in immediate danger, call 911 or your local emergency number. You are not alone.";
                                } else if (safetySignal.type === "harm_others") {
                                        reply = "I'm concerned by your message. If you or someone else is in immediate danger, please call 911 or your local emergency number right away. Step away from the situation and reach out to someone who can help you stay safe.";
                                }

                                // Escalate: notify trusted contact if permission granted
                                let trustedContactEnabled = false;
                                let trustedContactConfigured = false;
                                let trustedContactTarget = "";
                                let trustedContactDelivered = false;
                                let trustedContactDeliveryError = null;
                                try {
                                        const memRows = await db.all("SELECT key, value FROM user_memory WHERE user_id = ?", [userId]);
                                        const memory = {};
                                        for (const row of memRows) memory[row.key] = row.value;
                                        trustedContactEnabled =
                                                isTruthyPreference(memory.emergency_contact_permission) ||
                                                isTruthyPreference(memory["pref:emergency_contact_permission"]);
                                        trustedContactTarget = String(
                                                memory.emergency_contact ||
                                                memory["pref:emergency_contact"] ||
                                                ""
                                        ).trim();
                                        trustedContactConfigured = Boolean(trustedContactTarget);
                                } catch {}

                                if (trustedContactEnabled && trustedContactConfigured && trustedContactTarget) {
                                        const normalizedTrustedContactTarget = normalizeEmergencyContactTarget(trustedContactTarget);
                                        const trustedContactMessage =
                                                `Dex emergency alert for ${userInfo}. ` +
                                                `A serious safety concern was detected from this message: "${message}". ` +
                                                `Please check on them right away.`;
                                        if (normalizedTrustedContactTarget.includes("@")) {
                                                try {
                                                        trustedContactDelivered = await sendCustomEmail({
                                                                to: normalizedTrustedContactTarget,
                                                                subject: "Dex emergency contact alert",
                                                                body: trustedContactMessage,
                                                        });
                                                        if (!trustedContactDelivered) {
                                                                trustedContactDeliveryError = "email_not_sent";
                                                        }
                                                } catch (error) {
                                                        trustedContactDeliveryError = error?.message || "email_failed";
                                                        console.error("Emergency contact email error:", error?.message || error);
                                                }
                                        } else {
                                                try {
                                                        trustedContactDelivered = await sendSms(normalizedTrustedContactTarget, trustedContactMessage);
                                                } catch (error) {
                                                        trustedContactDeliveryError = error?.message || "sms_failed";
                                                        console.error("Emergency contact SMS error:", error?.message || error);
                                                }
                                        }
                                }

                                return res.json({
                                        reply: trustedContactDelivered
                                                ? reply + " I also used your emergency contact plan to reach out for extra support."
                                                : trustedContactEnabled && trustedContactConfigured
                                                        ? reply + " I tried to reach your emergency contact, but the message could not be confirmed. Please contact them directly if you can."
                                                        : !trustedContactConfigured
                                                                ? reply + " I do not have an emergency contact saved yet, so I could not send that alert."
                                                                : !trustedContactEnabled
                                                                        ? reply + " Emergency contact alerts are turned off in your settings, so I could not send that alert."
                                                                        : reply,
                                        emergency: true,
                                        emergencyType: safetySignal.type || "trusted_contact_request",
                                        emergencyContactRequested,
                                        trustedContactEnabled,
                                        trustedContactConfigured,
                                        trustedContactDelivered,
                                        trustedContactDeliveryError,
                                });
                        }

                        if (safetySignal.level === "support" || safetySignal.level === "urgent_support") {
                                const supportReply = buildSupportReply(safetySignal, learningPreferences);
                                if (supportReply) {
                                        const detectedTone = detectTone(message, voiceSignals);
                                        const styled = styleResponse(supportReply, detectedTone);
                                        await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, styled.text]);
                                        const followUpEnabled = learningPreferences.safety_follow_up_opt_in === "1";
                                        const followUpDelayMinutes = safetySignal.level === "urgent_support" ? 10 : 20;
                                        return res.json({
                                                reply: styled.text,
                                                support: true,
                                                supportLevel: safetySignal.level,
                                                supportType: safetySignal.type,
                                                tone: styled.meta?.detectedTone || detectedTone || "neutral",
                                                followUpSuggested: followUpEnabled,
                                                followUpDelayMinutes,
                                                followUpTitle: "Dex check-in",
                                                followUpMessage: "Dex is checking in after a hard moment. If you want support, open Dex and tell me what you need right now.",
                                        });
                                }
                        }

                        const webRequest = extractWebRequest(message);
                        if (webRequest) {
                                try {
                                        const searchData = webRequest.type === "web"
                                                ? await fetchDuckDuckGoInstantAnswer(webRequest.query)
                                                : null;
                                        const webReply = buildSearchReply(webRequest, searchData);
                                        await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [userId, message]);
                                        await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, webReply.reply]);
                                        return res.json(webReply);
                                } catch (error) {
                                        const fallback = webRequest.type === "youtube"
                                                ? buildSearchReply(webRequest)
                                                : {
                                                        reply: `I could not reach live web search right now, but I can still help from what I know. Web search link: https://duckduckgo.com/?q=${encodeURIComponent(webRequest.query)}`,
                                                        webAction: {
                                                                type: "web",
                                                                query: webRequest.query,
                                                                url: `https://duckduckgo.com/?q=${encodeURIComponent(webRequest.query)}`,
                                                                error: error?.message || "search_failed",
                                                        },
                                                };
                                        await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [userId, message]);
                                        await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, fallback.reply]);
                                        return res.json(fallback);
                                }
                        }

              const history = await db.all(
                    "SELECT role, content FROM chat_history WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20",
                    [userId, historyThreshold]
                  );
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
              const learnedWorkflows = isPaidSubscriber(user) ? await loadLearnedWorkflows(db, userId) : [];
              const workflowContext = buildWorkflowContext(learnedWorkflows);
    const messages = history.reverse().map((h) => ({ role: h.role, content: h.content }));
    if (learningContext) {
      messages.unshift({ role: "system", content: learningContext });
    }
    if (relationshipContext) {
      messages.unshift({ role: "system", content: relationshipContext });
    }
    if (workflowContext) {
      messages.unshift({ role: "system", content: workflowContext });
    }
    const detectedTone = detectTone(message, voiceSignals);
    const toneInstruction = getToneInstruction(detectedTone);
    if (toneInstruction) {
      messages.unshift({
        role: "system",
        content:
          `Tone-aware response mode: ${toneInstruction} ` +
          `Detected tone: ${detectedTone || "neutral"}. If the user seems sad, cheer them up gently. ` +
          `If angry, help calm them down. If happy, keep the happiness going. If anxious, steady the conversation.`,
      });
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

      let reply = completion.choices[0].message.content.trim();
                    const taughtWorkflow = extractTaughtWorkflow(message);
                    let learnedWorkflow = null;
                    if (taughtWorkflow && isPaidSubscriber(user)) {
                            try {
                                    await ensureMemoryTable(db);
                                    learnedWorkflow = await saveLearnedWorkflow(db, userId, taughtWorkflow);
                                    reply += `\n\nI saved that as a workflow: ${learnedWorkflow.title}. Next time you ask me to do that, I'll follow your steps.`;
                            } catch (error) {
                                    console.error("Workflow learning error:", error?.message || error);
                            }
                    }
                    const styledReply = styleResponse(reply, detectedTone);
                    reply = styledReply.text;
                    await db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [userId, reply]);

                        // Auto-learn frequent chat intents from DexIntentEngine.
                        const matchedIntent = dexRoute.actionIntent;
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

                        // â”€â”€ PROACTIVE AUTOMATION (with user consent) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€--
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
                        const appointmentIntent = matchedIntent === "schedule";
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
			// Remind automation — create a task_item so Dex tracks and delivers the reminder
			if (matchedIntent === "remind" && enabledAutomations["remind"]) {
				try {
					await ensureTaskItemsTable(db);
					await db.run(
                        `INSERT INTO task_items (user_id, title, details, kind, source)
                         VALUES (?, ?, ?, 'reminder', 'dex_chat')`,
                        [req.user.id, message.slice(0, 200), `Captured from chat: "${message.slice(0, 500)}"`]
					);
					automationPerformed = true;
				} catch (e) {
					console.error("Auto-reminder task creation failed:", e.message);
				}
			}
			// Call automation (stub)
			if (matchedIntent === "call" && enabledAutomations["call"]) {
				// Future: integrate with Android call trigger
				automationPerformed = true;
			}

                        return res.json({
                                reply,
                                appointmentIntent,
                                automationPerformed,
                                tone: styledReply.meta?.detectedTone || detectedTone || "neutral",
                                toneStyle: styledReply.meta?.appliedStyle || "neutral",
                                dexBrain,
                        });
              } catch (err) {
                    console.error("OpenAI error:", err.message);
                    const fallback = "Dex chat is temporarily unavailable. Please try again in a moment.";
                    return res.json({ reply: fallback, dexBrain });
              }
});


// â”€â”€ POST /api/dex/access â€” check access without chatting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const hasAccess = ["trial", "paid", "unlimited"].includes(access);
    const reason =
        access === "expired"
            ? "subscription_or_trial_expired"
            : hasAccess
                ? "ok"
                : "no_access";

    return res.json({
        access,
        access_type: access,
        hasAccess,
        trialDaysLeft,
        reason,
        checkoutRequired: !hasAccess,
        recoveryUrl: hasAccess ? null : `/settings?billing=recovery&reason=${access === "expired" ? "subscription_expired" : "no_access"}`,
    });
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

        // â”€â”€ AUTO-LEARN ROUTINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€---
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

        // Auto-schedule reminders for the new appointment
        try {
        	await scheduleAppointmentNotifications(db, req.user.id, { id: result.lastID, start_time });
        } catch (err) {
        	console.warn("[Appointment] Could not schedule notifications:", err.message);
        }

        return res.json({ success: true, id: result.lastID, title, start_time });
});

// Schedule reminders for an existing appointment by ID
router.post("/appointment/:id/notify", requireUser, async (req, res) => {
        const db = getDb();
        const appt = await db.get(
        	"SELECT * FROM appointments WHERE id = ? AND user_id = ?",
        	[req.params.id, req.user.id]
        );
        if (!appt) return res.status(404).json({ error: "Appointment not found." });
        await scheduleAppointmentNotifications(db, req.user.id, appt);
        res.json({ success: true, message: "Reminders scheduled." });
});

// Delete an appointment
router.delete("/appointment/:id", requireUser, async (req, res) => {
        const db = getDb();
        const appt = await db.get(
        	"SELECT id FROM appointments WHERE id = ? AND user_id = ?",
        	[req.params.id, req.user.id]
        );
        if (!appt) return res.status(404).json({ error: "Appointment not found." });
        await db.run("DELETE FROM appointments WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        await db.run("DELETE FROM appointment_notifications WHERE appointment_id = ?", [appt.id]);
        res.json({ success: true });
});

router.get("/appointments", requireUser, async (req, res) => {
    const db = getDb();
    const appts = await db.all(
          "SELECT * FROM appointments WHERE user_id = ? ORDER BY start_time ASC",
          [req.user.id]
        );
    return res.json(appts);
});

// ── SPECIAL DAYS ─────────────────────────────────────────────────────────────
// Birthdays, anniversaries, holidays, and any marked calendar day

async function ensureSpecialDaysTable(db) {
        await db.run(`
        	CREATE TABLE IF NOT EXISTS special_days (
        		id           INTEGER PRIMARY KEY AUTOINCREMENT,
        		user_id      INTEGER NOT NULL,
        		title        TEXT NOT NULL,
        		date         TEXT NOT NULL,
        		kind         TEXT NOT NULL DEFAULT 'reminder',
        		recur_yearly INTEGER NOT NULL DEFAULT 0,
        		notes        TEXT,
        		created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        		updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        	)
        `);
}

router.get("/special-days", requireUser, async (req, res) => {
        const db = getDb();
        await ensureSpecialDaysTable(db);
        const rows = await db.all(
        	"SELECT * FROM special_days WHERE user_id = ? ORDER BY date ASC",
        	[req.user.id]
        );
        res.json({ specialDays: rows });
});

router.post("/special-days", requireUser, [
        body("title").notEmpty().trim(),
        body("date").notEmpty(),
        body("kind").optional().isIn(["birthday", "anniversary", "holiday", "reminder"]),
], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const db = getDb();
        await ensureSpecialDaysTable(db);
        const { title, date, kind, recur_yearly, notes } = req.body;
        const result = await db.run(
        	`INSERT INTO special_days (user_id, title, date, kind, recur_yearly, notes)
        	 VALUES (?, ?, ?, ?, ?, ?)`,
        	[
        		req.user.id,
        		title.trim(),
        		date,
        		kind || "reminder",
        		recur_yearly ? 1 : 0,
        		notes || null,
        	]
        );
        const saved = await db.get("SELECT * FROM special_days WHERE id = ?", [result.lastID]);
        res.json({ success: true, specialDay: saved });
});

router.patch("/special-days/:id", requireUser, async (req, res) => {
        const db = getDb();
        await ensureSpecialDaysTable(db);
        const current = await db.get(
        	"SELECT * FROM special_days WHERE id = ? AND user_id = ?",
        	[req.params.id, req.user.id]
        );
        if (!current) return res.status(404).json({ error: "Special day not found." });
        const title = req.body.title !== undefined ? String(req.body.title).trim() : current.title;
        const date = req.body.date !== undefined ? req.body.date : current.date;
        const kind = req.body.kind !== undefined ? req.body.kind : current.kind;
        const recurYearly = req.body.recur_yearly !== undefined ? (req.body.recur_yearly ? 1 : 0) : current.recur_yearly;
        const notes = req.body.notes !== undefined ? req.body.notes : current.notes;
        await db.run(
        	`UPDATE special_days
        	    SET title = ?, date = ?, kind = ?, recur_yearly = ?, notes = ?, updated_at = datetime('now')
        	  WHERE id = ? AND user_id = ?`,
        	[title, date, kind, recurYearly, notes, req.params.id, req.user.id]
        );
        const updated = await db.get("SELECT * FROM special_days WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        res.json({ success: true, specialDay: updated });
});

router.delete("/special-days/:id", requireUser, async (req, res) => {
        const db = getDb();
        await ensureSpecialDaysTable(db);
        const row = await db.get(
        	"SELECT id FROM special_days WHERE id = ? AND user_id = ?",
        	[req.params.id, req.user.id]
        );
        if (!row) return res.status(404).json({ error: "Special day not found." });
        await db.run("DELETE FROM special_days WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
        res.json({ success: true });
});

router.get("/history", requireUser, async (req, res) => {
    const db = getDb();
    const history = await db.all(
          "SELECT role, content, created_at FROM chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 100",
          [req.user.id]
        );
    return res.json(history);
});

// POST /api/dex/games/chess/move
router.post("/games/chess/move", requireUser, async (req, res) => {
        const user = await getUserRecord(req.user.id);
        if (!userHasDexAccess(user)) {
                return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial to play games with Dex." });
        }

        const { board, history: moveHistory = [] } = req.body || {};
        if (!board) return res.status(400).json({ error: "board state required" });

        try {
                const openai = getOpenAI();
                const boardStr = Array.isArray(board)
                        ? board.map((row, r) => row.map((cell, c) => cell ? `${cell}@${String.fromCharCode(97+c)}${8-r}` : ".").join(" ")).join("\n")
                        : String(board);
                const historyStr = moveHistory.slice(-10).join(", ") || "none";

                const completion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
                        messages: [
                                {
                                        role: "system",
                                        content: "You are Dex, a chess-playing AI. You play as Black pieces. Given the current board state and move history, respond with exactly one legal chess move in algebraic notation (e.g. e5, Nf6, O-O). Respond with only the move notation and a brief one-sentence comment.",
                                },
                                {
                                        role: "user",
                                        content: `Board (rows 8 to 1, columns a-h):\n${boardStr}\n\nMove history: ${historyStr}\n\nPick your best move as Black. Reply: <move> | <short comment>`,
                                },
                        ],
                        max_tokens: 60,
                        temperature: 0.4,
                });

                const raw = completion.choices[0].message.content.trim();
                const [move, ...commentParts] = raw.split("|");
                return res.json({
                        move: move.trim(),
                        comment: commentParts.join("|").trim() || "Your move.",
                });
        } catch (err) {
                console.error("Chess move error:", err.message);
                return res.status(500).json({ error: "Dex could not pick a chess move right now." });
        }
});

// POST /api/dex/games/checkers/move
router.post("/games/checkers/move", requireUser, async (req, res) => {
        const user = await getUserRecord(req.user.id);
        if (!userHasDexAccess(user)) {
                return res.status(403).json({ error: "no_access", message: "Start your free 3-day trial to play games with Dex." });
        }

        const { board, history: moveHistory = [] } = req.body || {};
        if (!board) return res.status(400).json({ error: "board state required" });

        try {
                const openai = getOpenAI();
                const boardStr = Array.isArray(board)
                        ? board.map((row, r) => row.map((cell, c) => cell || ".").join(" ")).join("\n")
                        : String(board);
                const historyStr = moveHistory.slice(-6).join(", ") || "none";

                const completion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
                        messages: [
                                {
                                        role: "system",
                                        content: "You are Dex, a checkers-playing AI. You play as the dark pieces (marked 'd' or 'D' for kings). Given the 8x8 board and move history, respond with exactly one legal checkers move as 'fromRow,fromCol->toRow,toCol'. Multiple jumps use 'fromRow,fromCol->midRow,midCol->toRow,toCol'. Respond with only the move and a brief one-sentence comment.",
                                },
                                {
                                        role: "user",
                                        content: `Board (row 0 = top):\n${boardStr}\n\nMove history: ${historyStr}\n\nPick your best move as dark pieces. Reply: <move> | <short comment>`,
                                },
                        ],
                        max_tokens: 60,
                        temperature: 0.4,
                });

                const raw = completion.choices[0].message.content.trim();
                const [move, ...commentParts] = raw.split("|");
                return res.json({
                        move: move.trim(),
                        comment: commentParts.join("|").trim() || "Your move.",
                });
        } catch (err) {
                console.error("Checkers move error:", err.message);
                return res.status(500).json({ error: "Dex could not pick a checkers move right now." });
        }
});

export default router;

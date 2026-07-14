// Proactive notification scheduler for Dex
// Sends appointment reminders, special-day alerts, and daily briefings via SMS/email.

import { getDb } from "../db.js";
import { sendSms } from "./communications.js";
import { sendCustomEmail } from "./email.js";

// How many minutes before an appointment to send a reminder
const REMINDER_OFFSETS_MINUTES = [
  { label: "1 day", minutes: 24 * 60 },
  { label: "1 hour", minutes: 60 },
  { label: "15 minutes", minutes: 15 },
];

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function getUserContactInfo(db, userId) {
  const user = await db.get("SELECT id, email, name FROM users WHERE id = ?", [userId]);
  const row = await db.get("SELECT permissions FROM user_permissions WHERE user_id = ?", [userId]);
  let permissions = {};
  if (row?.permissions) {
    try { permissions = JSON.parse(row.permissions); } catch {}
  }
  const phoneRow = await db.get(
    "SELECT value FROM user_memory WHERE user_id = ? AND key = 'pref:notification_phone'",
    [userId]
  );
  const phone = phoneRow?.value || null;
  return { user, permissions, phone };
}

async function deliverNotification(db, userId, subject, message) {
  const { user, permissions, phone } = await getUserContactInfo(db, userId);
  if (!user) return;

  const delivered = [];

  if (phone && permissions.notifications !== false) {
    try {
      await sendSms(phone, message);
      delivered.push("sms");
    } catch (err) {
      console.warn(`[Scheduler] SMS delivery failed for user ${userId}:`, err.message);
    }
  }

  if (user.email && permissions.notifications !== false) {
    try {
      await sendCustomEmail({ to: user.email, subject, body: message });
      delivered.push("email");
    } catch (err) {
      console.warn(`[Scheduler] Email delivery failed for user ${userId}:`, err.message);
    }
  }

  return delivered;
}

async function ensureNotificationTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      appointment_id  INTEGER NOT NULL,
      notify_at       TEXT NOT NULL,
      channel         TEXT NOT NULL DEFAULT 'combined',
      sent            INTEGER NOT NULL DEFAULT 0,
      sent_at         TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(appointment_id, notify_at, channel)
    )
  `);
  await db.exec(`
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
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT,
      PRIMARY KEY(user_id, key)
    )
  `);
}

// Seed pending notification rows for a new appointment
export async function scheduleAppointmentNotifications(db, userId, appointment) {
  await ensureNotificationTables(db);
  const start = new Date(appointment.start_time);
  if (Number.isNaN(start.getTime())) return;

  for (const offset of REMINDER_OFFSETS_MINUTES) {
    const notifyAt = new Date(start.getTime() - offset.minutes * 60 * 1000);
    if (notifyAt <= new Date()) continue; // skip if already past
    await db.run(
      `INSERT OR IGNORE INTO appointment_notifications
         (user_id, appointment_id, notify_at, channel)
       VALUES (?, ?, ?, 'combined')`,
      [userId, appointment.id, notifyAt.toISOString()]
    );
  }
}

// Send pending appointment reminders that are due now
async function checkAppointmentReminders(db) {
  const now = new Date().toISOString();
  const pending = await db.all(
    `SELECT an.id, an.user_id, an.appointment_id, an.notify_at,
            a.title, a.description, a.start_time
       FROM appointment_notifications an
       JOIN appointments a ON a.id = an.appointment_id
      WHERE an.sent = 0
        AND an.notify_at <= ?
      LIMIT 50`,
    [now]
  );

  for (const row of pending) {
    const minutesAway = Math.round((new Date(row.start_time) - new Date()) / 60000);
    const timeLabel =
      minutesAway > 90 ? `in about ${Math.round(minutesAway / 60)} hour(s)` :
      minutesAway > 0  ? `in ${minutesAway} minute(s)` :
      "now / just started";

    const subject = `Dex reminder: ${row.title} ${timeLabel}`;
    const message =
      `Dex reminder: "${row.title}" is coming up ${timeLabel}.\n` +
      `${row.description ? `Details: ${row.description}\n` : ""}` +
      `Scheduled: ${formatDateTime(row.start_time)}`;

    try {
      await deliverNotification(db, row.user_id, subject, message);
      await db.run(
        `UPDATE appointment_notifications SET sent = 1, sent_at = ? WHERE id = ?`,
        [new Date().toISOString(), row.id]
      );
    } catch (err) {
      console.error(`[Scheduler] Failed to send appointment reminder id=${row.id}:`, err.message);
    }
  }
}

// Send special-day (birthday/anniversary/holiday) alerts on the day
async function checkSpecialDays(db) {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthDay = todayKey.slice(5); // MM-DD for recurring checks

  // Exact-date matches
  const exactRows = await db.all(
    `SELECT * FROM special_days WHERE date = ? AND recur_yearly = 0`,
    [todayKey]
  );
  // Recurring yearly (match MM-DD portion)
  const recurRows = await db.all(
    `SELECT * FROM special_days WHERE substr(date, 6) = ? AND recur_yearly = 1`,
    [monthDay]
  );
  const rows = [...exactRows, ...recurRows];

  for (const row of rows) {
    const cacheKey = `pref:special_day_notified:${row.id}:${todayKey}`;
    const already = await db.get(
      `SELECT value FROM user_memory WHERE user_id = ? AND key = ?`,
      [row.user_id, cacheKey]
    );
    if (already) continue;

    const kindLabel = row.kind === "birthday" ? "Birthday" :
                      row.kind === "anniversary" ? "Anniversary" :
                      row.kind === "holiday" ? "Holiday" : "Reminder";
    const subject = `Dex: ${kindLabel} — ${row.title}`;
    const message =
      `Dex reminder: Today is ${row.title}!\n` +
      (row.notes ? `Notes: ${row.notes}` : "");

    try {
      await deliverNotification(db, row.user_id, subject, message);
      // Mark as sent for today
      await db.run(
        `INSERT OR REPLACE INTO user_memory (user_id, key, value) VALUES (?, ?, '1')`,
        [row.user_id, cacheKey]
      );
    } catch (err) {
      console.error(`[Scheduler] Failed to send special-day alert id=${row.id}:`, err.message);
    }
  }
}

// Send daily briefing via SMS/email at user's configured time
async function checkDailyBriefings(db) {
  const now = new Date();
  const hourMin = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const todayKey = now.toISOString().slice(0, 10);

  // Find users who have briefing enabled at this hour:minute
  const rows = await db.all(
    `SELECT DISTINCT um.user_id
       FROM user_memory um
      WHERE um.key = 'pref:daily_briefing_enabled' AND um.value = '1'`
  );

  for (const row of rows) {
    const userId = row.user_id;
    const timeRow = await db.get(
      `SELECT value FROM user_memory WHERE user_id = ? AND key = 'pref:daily_briefing_time'`,
      [userId]
    );
    const configuredTime = timeRow?.value || "08:00";
    if (configuredTime !== hourMin) continue;

    // Don't send more than once per day
    const cacheKey = `pref:briefing_sent:${todayKey}`;
    const already = await db.get(
      `SELECT value FROM user_memory WHERE user_id = ? AND key = ?`,
      [userId, cacheKey]
    );
    if (already) continue;

    // Build a simple text briefing
    try {
      const user = await db.get("SELECT id, email, name FROM users WHERE id = ?", [userId]);
      if (!user) continue;

      const todayStart = `${todayKey}T00:00:00.000Z`;
      const todayEnd = `${todayKey}T23:59:59.999Z`;
      const [appointments, tasks] = await Promise.all([
        db.all(
          `SELECT title, start_time FROM appointments
            WHERE user_id = ? AND start_time >= ? AND start_time <= ?
            ORDER BY start_time ASC LIMIT 10`,
          [userId, todayStart, todayEnd]
        ),
        db.all(
          `SELECT title, due_at FROM task_items
            WHERE user_id = ? AND status != 'done'
            ORDER BY due_at ASC LIMIT 5`,
          [userId]
        ),
      ]);

      let lines = [`Good morning${user.name ? `, ${user.name}` : ""}! Here's your Dex briefing for ${todayKey}.`];
      if (appointments.length) {
        lines.push(`\nToday's calendar (${appointments.length} event${appointments.length > 1 ? "s" : ""}):`);
        for (const a of appointments) {
          lines.push(`  • ${a.title} — ${formatDateTime(a.start_time)}`);
        }
      } else {
        lines.push("\nNo calendar events today.");
      }
      if (tasks.length) {
        lines.push(`\nOpen tasks (${tasks.length}):`);
        for (const t of tasks) {
          lines.push(`  • ${t.title}${t.due_at ? ` (due ${formatDateTime(t.due_at)})` : ""}`);
        }
      }
      lines.push("\nHave a great day — Dex is here when you need me.");

      const message = lines.join("\n");
      const subject = `Your Dex daily briefing — ${todayKey}`;
      await deliverNotification(db, userId, subject, message);

      await db.run(
        `INSERT OR REPLACE INTO user_memory (user_id, key, value) VALUES (?, ?, '1')`,
        [userId, cacheKey]
      );
    } catch (err) {
      console.error(`[Scheduler] Daily briefing failed for user ${userId}:`, err.message);
    }
  }
}

let _schedulerInterval = null;

export function startNotificationScheduler() {
  const intervalMs = parseInt(process.env.NOTIFICATION_CHECK_INTERVAL_MS || "60000", 10);
  if (_schedulerInterval) return;

  _schedulerInterval = setInterval(async () => {
    let db;
    try {
      db = getDb();
    } catch {
      return; // DB not ready yet
    }
    try { await ensureNotificationTables(db); } catch {}
    try { await checkAppointmentReminders(db); } catch (err) {
      console.error("[Scheduler] Appointment reminders error:", err.message);
    }
    try { await checkSpecialDays(db); } catch (err) {
      console.error("[Scheduler] Special days error:", err.message);
    }
    try { await checkDailyBriefings(db); } catch (err) {
      console.error("[Scheduler] Daily briefings error:", err.message);
    }
  }, intervalMs);

  console.log(`✅ Dex notification scheduler started (every ${intervalMs / 1000}s)`);
}

export function stopNotificationScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
}

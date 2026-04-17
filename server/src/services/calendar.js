// Calendar service for Dex AI
// Manages event creation and listing with SQLite backend

import { getDb } from '../db.js';

/**
 * Create a new calendar event
 * @param {Object} eventData - Event details
 * @param {string} eventData.title - Event title
 * @param {string} eventData.description - Event description
 * @param {string} eventData.startTime - ISO start time
 * @param {string} eventData.endTime - ISO end time
 * @param {string} [eventData.userId] - Associated user ID
 * @returns {Object} Created event
 */
export async function createEvent({ title, description, startTime, endTime, userId = null }) {
    try {
          const db = getDb();
          await db.run(
                  `CREATE TABLE IF NOT EXISTS calendar_events (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                                  user_id TEXT,
                                          title TEXT NOT NULL,
                                                  description TEXT,
                                                          start_time TEXT NOT NULL,
                                                                  end_time TEXT,
                                                                          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                                                )`
                );
          const result = await db.run(
                  `INSERT INTO calendar_events (user_id, title, description, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
                  [userId, title, description || null, startTime, endTime || null]
                );
          console.log(`Calendar event created: ${title} at ${startTime}`);
          return { id: result.lastID, title, startTime, endTime };
    } catch (err) {
          console.error('Calendar createEvent error:', err.message);
          throw err;
    }
}

/**
 * List calendar events, optionally filtered by user
 * @param {Object} [options]
 * @param {string} [options.userId] - Filter by user
 * @param {number} [options.limit] - Max results (default 20)
 * @returns {Array} List of events
 */
export async function listEvents({ userId = null, limit = 20 } = {}) {
    try {
          const db = getDb();
          await db.run(
                  `CREATE TABLE IF NOT EXISTS calendar_events (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                                  user_id TEXT,
                                          title TEXT NOT NULL,
                                                  description TEXT,
                                                          start_time TEXT NOT NULL,
                                                                  end_time TEXT,
                                                                          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                                                )`
                );
          let query = 'SELECT * FROM calendar_events';
          const params = [];
          if (userId) {
                  query += ' WHERE user_id = ?';
                  params.push(userId);
          }
          query += ' ORDER BY start_time ASC LIMIT ?';
          params.push(limit);
          return await db.all(query, params);
    } catch (err) {
          console.error('Calendar listEvents error:', err.message);
          return [];
    }
}

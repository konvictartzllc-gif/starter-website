// Dex AI database initialization and schema
// Source: server/src/db.js

import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDb({ dbPath, adminUsername, adminPassword }) {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA journal_mode = WAL;");

  await db.exec(`...`); // Truncated for brevity
  // ...existing code from db.js...
}

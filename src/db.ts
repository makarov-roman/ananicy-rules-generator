import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = join(import.meta.dirname!, "..", "data", "games.db");

export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS title (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      reviews INTEGER NOT NULL,
      median2weeks INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS launch_option (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appid INTEGER NOT NULL REFERENCES title(appid),
      platform TEXT NOT NULL,
      bin TEXT NOT NULL
    )
  `);

  return db;
}

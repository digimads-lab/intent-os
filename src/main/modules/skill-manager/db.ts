/**
 * M-02 Skill Manager — SQLite database initialisation
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'

const DB_PATH = path.join(app.getPath('userData'), 'intentos-skills.db')

export function createDatabase(): Database.Database {
  const db = new Database(DB_PATH)

  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      description TEXT DEFAULT '',
      author TEXT DEFAULT '',
      capabilities TEXT DEFAULT '[]',
      dependencies TEXT DEFAULT '[]',
      entryPoint TEXT NOT NULL,
      manifestPath TEXT NOT NULL,
      directoryPath TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      registeredAt TEXT NOT NULL,

      CHECK (
        id IS NOT NULL AND
        name IS NOT NULL AND
        version IS NOT NULL AND
        entryPoint IS NOT NULL AND
        directoryPath IS NOT NULL
      )
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_skills_version ON skills(version);

    CREATE TABLE IF NOT EXISTS skill_app_refs (
      skillId TEXT NOT NULL,
      appId TEXT NOT NULL,
      appName TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (skillId, appId),
      FOREIGN KEY (skillId) REFERENCES skills(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_skill_app_refs_skillId ON skill_app_refs(skillId);
    CREATE INDEX IF NOT EXISTS idx_skill_app_refs_appId ON skill_app_refs(appId);
  `)

  return db
}

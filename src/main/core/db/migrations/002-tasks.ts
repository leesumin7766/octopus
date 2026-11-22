import type { Migration } from '../migrate'

export const migration002: Migration = {
  version: 2,
  name: 'tasks',
  up(db) {
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'canceled')),
        bucket TEXT NOT NULL CHECK (bucket IN ('inbox', 'scheduled', 'someday')),
        date TEXT,
        time TEXT,
        deadline TEXT,
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
        project TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        repeat TEXT,
        routine_id TEXT,
        source TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        done_at TEXT
      );
      CREATE INDEX idx_tasks_status_date ON tasks (status, date);
    `)
  }
}

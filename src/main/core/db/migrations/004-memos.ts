import type { Migration } from '../migrate'

export const migration004: Migration = {
  version: 4,
  name: 'memos',
  up(db) {
    db.exec(`
      CREATE TABLE memos (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_memos_order ON memos (pinned DESC, updated_at DESC);
      CREATE INDEX idx_memos_task ON memos (task_id);
    `)
  }
}

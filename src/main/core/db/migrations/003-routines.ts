import type { Migration } from '../migrate'

export const migration003: Migration = {
  version: 3,
  name: 'routines',
  up(db) {
    db.exec(`
      CREATE TABLE routines (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        days TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- 루틴 하나는 하루에 할 일 하나만 만든다. routine_id 가 없는 일반 할 일은 제외.
      CREATE UNIQUE INDEX idx_tasks_routine_date ON tasks (routine_id, date) WHERE routine_id IS NOT NULL;
    `)
  }
}

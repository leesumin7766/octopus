import type { Migration } from '../migrate'

export const migration005: Migration = {
  version: 5,
  name: 'shortcuts',
  up(db) {
    db.exec(`
      CREATE TABLE shortcuts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('url', 'path')),
        -- 경로 바로가기가 파일인지 폴더인지(아이콘용). URL 이면 NULL.
        path_type TEXT CHECK (path_type IN ('file', 'folder')),
        label TEXT NOT NULL,
        target TEXT NOT NULL,
        -- 실행 파일 바로가기를 처음 열 때 사용자가 허용했는지
        allowed INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((kind = 'url' AND path_type IS NULL) OR (kind = 'path' AND path_type IS NOT NULL))
      );
      CREATE INDEX idx_shortcuts_order ON shortcuts (sort_order);
    `)
  }
}

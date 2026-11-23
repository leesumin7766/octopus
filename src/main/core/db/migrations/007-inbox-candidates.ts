import type { Migration } from '../migrate'

export const migration007: Migration = {
  version: 7,
  name: 'inbox-candidates',
  up(db) {
    db.exec(`
      -- Arm 이 보내 온 할 일 후보. 사용자가 수신함에 넣기 전에는 할 일이 아니다.
      CREATE TABLE inbox_candidates (
        id TEXT PRIMARY KEY,
        arm_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        url TEXT,
        due_date TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
        -- 같은 원본을 다시 넣어도 중복이 생기지 않고, 무시한 것이 다시 나타나지 않게 한다(상태와 상관없이 한 줄만).
        UNIQUE (arm_id, ref)
      );
      CREATE INDEX idx_inbox_candidates_status ON inbox_candidates (status, created_at);
    `)
  }
}

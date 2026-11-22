import type { Migration } from '../migrate'

export const migration006: Migration = {
  version: 6,
  name: 'command',
  up(db) {
    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_conversations_updated ON conversations (updated_at DESC);

      -- 대화 내용은 추가만 한다(고치지 않음). content 는 ContentBlock[] 의 JSON.
      CREATE TABLE conversation_messages (
        conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, seq)
      );
    `)
  }
}

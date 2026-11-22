import type { DatabaseSync } from 'node:sqlite'
import type { ContentBlock, ConversationSummary, Message } from '../../../shared/command/types'
import { EntityNotFoundError } from '../errors'

export class ConversationNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('conversation', id)
  }
}

export interface ConversationRepository {
  create(input: { title: string; modelId: string }): ConversationSummary
  get(id: string): ConversationSummary | undefined
  list(): ConversationSummary[]
  remove(id: string): boolean
  /** 메시지를 뒤에 덧붙인다. 기존 메시지는 고치지 않는다. */
  append(id: string, message: Message): void
  messages(id: string): Message[]
  setModel(id: string, modelId: string): void
}

interface Row {
  id: string
  title: string
  model_id: string
  created_at: string
  updated_at: string
}

const toSummary = (row: Row): ConversationSummary => ({
  id: row.id,
  title: row.title,
  modelId: row.model_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

export function createConversationRepository(
  db: DatabaseSync,
  deps: { newId: () => string; now: () => string }
): ConversationRepository {
  const touch = (id: string): void => {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(deps.now(), id)
  }

  return {
    create({ title, modelId }) {
      const id = deps.newId()
      const now = deps.now()
      db.prepare('INSERT INTO conversations (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        title.slice(0, 80),
        modelId,
        now,
        now
      )
      return this.get(id) as ConversationSummary
    },

    get(id) {
      const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Row | undefined
      return row ? toSummary(row) : undefined
    },

    list() {
      const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC, id DESC').all() as unknown as Row[]
      return rows.map(toSummary)
    },

    remove(id) {
      return Number(db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes) > 0
    },

    append(id, message) {
      if (!this.get(id)) throw new ConversationNotFoundError(id)
      const next = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM conversation_messages WHERE conversation_id = ?').get(id) as {
        n: number
      }
      db.prepare('INSERT INTO conversation_messages (conversation_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        next.n,
        message.role,
        JSON.stringify(message.content),
        deps.now()
      )
      touch(id)
    },

    messages(id) {
      const rows = db
        .prepare('SELECT role, content FROM conversation_messages WHERE conversation_id = ? ORDER BY seq')
        .all(id) as unknown as { role: 'user' | 'assistant'; content: string }[]
      return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) as ContentBlock[] }))
    },

    setModel(id, modelId) {
      db.prepare('UPDATE conversations SET model_id = ?, updated_at = ? WHERE id = ?').run(modelId, deps.now(), id)
    }
  }
}

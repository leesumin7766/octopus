import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'

describe('migration 006 (command)', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
  })
  afterEach(() => db.close())

  it('applies on top of version 5 and keeps existing data', () => {
    runMigrations(db, migrations.slice(0, 5))
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('k', 'v')").run()

    expect(runMigrations(db, migrations.slice(0, 6))).toBe(6)

    expect(db.prepare('SELECT value FROM app_meta WHERE key = ?').get('k')).toEqual({ value: 'v' })
    const columns = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(columns('conversations')).toEqual(['id', 'title', 'model_id', 'created_at', 'updated_at'])
    expect(columns('conversation_messages')).toEqual(['conversation_id', 'seq', 'role', 'content', 'created_at'])
  })

  it('refuses a message without a conversation, a bad role, or a repeated seq', () => {
    runMigrations(db, migrations)
    const msg = (id: string, seq: number, role: string) =>
      db.prepare('INSERT INTO conversation_messages VALUES (?, ?, ?, ?, ?)').run(id, seq, role, '[]', 'x')
    expect(() => msg('nope', 1, 'user')).toThrow()
    db.prepare("INSERT INTO conversations VALUES ('C', 't', 'm', 'x', 'x')").run()
    expect(() => msg('C', 1, 'system')).toThrow()
    msg('C', 1, 'user')
    expect(() => msg('C', 1, 'assistant')).toThrow()
  })

  it('deleting a conversation deletes its messages', () => {
    runMigrations(db, migrations)
    db.prepare("INSERT INTO conversations VALUES ('C', 't', 'm', 'x', 'x')").run()
    db.prepare("INSERT INTO conversation_messages VALUES ('C', 1, 'user', '[]', 'x')").run()
    db.prepare("DELETE FROM conversations WHERE id = 'C'").run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversation_messages').get()).toEqual({ n: 0 })
  })
})

import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { migration001 } from '../../src/main/core/db/migrations/001-app-meta'

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function columns(db: DatabaseSync): string[] {
  return (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name)
}

function insertTask(db: DatabaseSync, overrides: Record<string, string | number | null> = {}): void {
  const row = {
    id: '01TASK',
    title: 't',
    status: 'open',
    bucket: 'inbox',
    priority: 0,
    sort_order: 1,
    created_at: '2026-03-10T00:00:00.000Z',
    updated_at: '2026-03-10T00:00:00.000Z',
    ...overrides
  }
  const names = Object.keys(row)
  db.prepare(`INSERT INTO tasks (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(
    ...Object.values(row)
  )
}

describe('migration 002 (tasks)', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('applies on an empty database: user_version=2 and the tasks table exists', () => {
    expect(runMigrations(db, migrations)).toBe(2)

    expect(userVersion(db)).toBe(2)
    expect(columns(db)).toEqual([
      'id',
      'title',
      'notes',
      'status',
      'bucket',
      'date',
      'time',
      'deadline',
      'priority',
      'project',
      'tags',
      'repeat',
      'routine_id',
      'source',
      'sort_order',
      'created_at',
      'updated_at',
      'done_at'
    ])
  })

  it('continues on a database that only has 001, keeping its data', () => {
    runMigrations(db, [migration001])
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('k', 'v')
    expect(userVersion(db)).toBe(1)

    expect(runMigrations(db, migrations)).toBe(2)

    expect(userVersion(db)).toBe(2)
    expect(db.prepare('SELECT value FROM app_meta WHERE key = ?').get('k')).toEqual({ value: 'v' })
    expect(columns(db)).toContain('title')
  })

  it('creates the (status, date) index', () => {
    runMigrations(db, migrations)
    const indexes = db.prepare('PRAGMA index_list(tasks)').all() as { name: string }[]

    expect(indexes.map((i) => i.name)).toContain('idx_tasks_status_date')
  })

  it('accepts a valid row', () => {
    runMigrations(db, migrations)

    expect(() => insertTask(db)).not.toThrow()
  })

  it('rejects rows that break the CHECK constraints', () => {
    runMigrations(db, migrations)

    expect(() => insertTask(db, { status: 'archived' })).toThrow(/CHECK/)
    expect(() => insertTask(db, { bucket: 'later' })).toThrow(/CHECK/)
    expect(() => insertTask(db, { priority: 4 })).toThrow(/CHECK/)
    expect(() => insertTask(db, { priority: -1 })).toThrow(/CHECK/)
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 })
  })
})

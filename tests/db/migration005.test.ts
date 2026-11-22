import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'

describe('migration 005 (shortcuts)', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  const insert = (kind: string, pathType: string | null, extra: Record<string, unknown> = {}) => {
    const row = { id: 'S1', kind, path_type: pathType, label: 'l', target: 't', sort_order: 1, created_at: 'x', updated_at: 'x', ...extra }
    const names = Object.keys(row)
    db.prepare(`INSERT INTO shortcuts (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(
      ...(Object.values(row) as (string | number | null)[])
    )
  }

  it('applies on top of version 4 and keeps existing data', () => {
    runMigrations(db, migrations.slice(0, 4))
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('k', 'v')").run()

    expect(runMigrations(db, migrations.slice(0, 5))).toBe(5)

    expect(db.prepare('SELECT value FROM app_meta WHERE key = ?').get('k')).toEqual({ value: 'v' })
    const columns = (db.prepare('PRAGMA table_info(shortcuts)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).toEqual(['id', 'kind', 'path_type', 'label', 'target', 'allowed', 'sort_order', 'created_at', 'updated_at'])
  })

  it('accepts a link without a path type and a path with one', () => {
    runMigrations(db, migrations)

    expect(() => insert('url', null, { id: 'A' })).not.toThrow()
    expect(() => insert('path', 'file', { id: 'B' })).not.toThrow()
    expect(() => insert('path', 'folder', { id: 'C' })).not.toThrow()
    expect(db.prepare("SELECT allowed FROM shortcuts WHERE id = 'A'").get()).toEqual({ allowed: 0 })
  })

  it('refuses kinds and path types that do not fit', () => {
    runMigrations(db, migrations)

    expect(() => insert('mail', null)).toThrow(/CHECK/)
    expect(() => insert('url', 'file')).toThrow(/CHECK/) // 링크에는 경로 종류가 없다
    expect(() => insert('path', null)).toThrow(/CHECK/) // 경로에는 있어야 한다
    expect(() => insert('path', 'socket')).toThrow(/CHECK/)
    expect(() => insert('url', null, { allowed: 2 })).toThrow(/CHECK/)
  })
})

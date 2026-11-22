import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations, type Migration } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
}

describe('runMigrations', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('applies 001 to an empty database: user_version=1 and app_meta exists', () => {
    expect(userVersion(db)).toBe(0)

    const version = runMigrations(db, migrations)

    expect(version).toBe(1)
    expect(userVersion(db)).toBe(1)
    expect(tableExists(db, 'app_meta')).toBe(true)
  })

  it('does nothing when run twice', () => {
    runMigrations(db, migrations)
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('k', 'v')

    expect(runMigrations(db, migrations)).toBe(1)

    expect(userVersion(db)).toBe(1)
    expect(db.prepare('SELECT value FROM app_meta WHERE key = ?').get('k')).toEqual({ value: 'v' })
  })

  it('rolls back a failing migration and keeps the version', () => {
    const failing: Migration = {
      version: 2,
      name: 'failing',
      up(target) {
        target.exec('CREATE TABLE half_done (id INTEGER)')
        throw new Error('boom')
      }
    }

    runMigrations(db, migrations)
    expect(() => runMigrations(db, [...migrations, failing])).toThrow(/migration 2 \(failing\) failed/)

    expect(userVersion(db)).toBe(1)
    expect(tableExists(db, 'half_done')).toBe(false)
  })

  it('refuses a migration list that is not in ascending order', () => {
    const noop = (version: number): Migration => ({ version, name: `m${version}`, up: () => {} })

    expect(() => runMigrations(db, [noop(2), noop(1)])).toThrow(/invalid migration list/)
    expect(userVersion(db)).toBe(0)
  })

  it('refuses a database that is newer than the app', () => {
    db.exec('PRAGMA user_version = 5')

    expect(() => runMigrations(db, migrations)).toThrow(/newer than this app supports/)
    expect(userVersion(db)).toBe(5)
  })
})

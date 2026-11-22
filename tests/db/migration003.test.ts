import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { migration001 } from '../../src/main/core/db/migrations/001-app-meta'
import { migration002 } from '../../src/main/core/db/migrations/002-tasks'

const upTo2 = [migration001, migration002]

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function insertTask(db: DatabaseSync, id: string, routineId: string | null, date: string | null): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, bucket, date, routine_id, sort_order, created_at, updated_at)
     VALUES (?, 't', 'open', ?, ?, ?, 1, 'x', 'x')`
  ).run(id, date === null ? 'inbox' : 'scheduled', date, routineId)
}

describe('migration 003 (routines)', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('applies on top of a database that has tasks, keeping them', () => {
    runMigrations(db, upTo2)
    insertTask(db, '01A', null, '2026-03-10')
    insertTask(db, '01B', null, '2026-03-10')

    expect(runMigrations(db, migrations.slice(0, 3))).toBe(3)

    expect(userVersion(db)).toBe(3)
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 2 })
    const columns = (db.prepare('PRAGMA table_info(routines)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).toEqual(['id', 'title', 'days', 'active', 'sort_order', 'created_at', 'updated_at'])
  })

  it('does not accept a routine with a wrong active value', () => {
    runMigrations(db, migrations)

    expect(() =>
      db
        .prepare("INSERT INTO routines (id, title, days, active, sort_order, created_at, updated_at) VALUES ('1', 't', '[1]', 2, 1, 'x', 'x')")
        .run()
    ).toThrow(/CHECK/)
  })

  it('one task per routine and date: duplicates are refused, other cases are fine', () => {
    runMigrations(db, migrations)
    insertTask(db, '01A', 'R1', '2026-03-10')

    expect(() => insertTask(db, '01B', 'R1', '2026-03-10')).toThrow(/UNIQUE/)
    expect(() => insertTask(db, '01C', 'R1', '2026-03-11')).not.toThrow() // 다른 날
    expect(() => insertTask(db, '01D', 'R2', '2026-03-10')).not.toThrow() // 다른 루틴
    // routine_id 가 없는 일반 할 일은 같은 날짜가 몇 개든 괜찮다
    expect(() => insertTask(db, '01E', null, '2026-03-10')).not.toThrow()
    expect(() => insertTask(db, '01F', null, '2026-03-10')).not.toThrow()
    expect(() => insertTask(db, '01G', null, null)).not.toThrow()
  })
})

describe('migration 004 (memos)', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  function insertMemo(id: string, taskId: string | null, pinned = 0): void {
    db.prepare('INSERT INTO memos (id, body, pinned, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      '본문',
      pinned,
      taskId,
      'x',
      'x'
    )
  }

  it('applies from version 3: user_version=4 and the memos table exists', () => {
    runMigrations(db, migrations.slice(0, 3))

    expect(runMigrations(db, migrations)).toBe(4)

    expect(userVersion(db)).toBe(4)
    const columns = (db.prepare('PRAGMA table_info(memos)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).toEqual(['id', 'body', 'pinned', 'task_id', 'created_at', 'updated_at'])
  })

  it('the full list reaches version 4 on an empty database', () => {
    expect(runMigrations(db, migrations)).toBe(4)
  })

  it('pinned only takes 0 or 1', () => {
    runMigrations(db, migrations)

    expect(() => insertMemo('01A', null, 2)).toThrow(/CHECK/)
    expect(() => insertMemo('01B', null, 1)).not.toThrow()
  })

  it('a memo can only point at a task that exists', () => {
    runMigrations(db, migrations)

    expect(() => insertMemo('01A', 'no-such-task')).toThrow(/FOREIGN KEY/)
  })

  it('deleting the linked task clears the link and keeps the memo', () => {
    runMigrations(db, migrations)
    insertTask(db, 'T1', null, '2026-03-10')
    insertMemo('M1', 'T1')

    db.prepare("DELETE FROM tasks WHERE id = 'T1'").run()

    expect(db.prepare("SELECT task_id AS taskId FROM memos WHERE id = 'M1'").get()).toEqual({ taskId: null })
  })
})

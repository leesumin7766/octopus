import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/core/db/connection'
import { migrations } from '../../src/main/core/db/migrations'
import { runMigrations } from '../../src/main/core/db/migrate'
import { createTaskRepository } from '../../src/main/core/tasks/taskRepository'

// C2-09: 저장한 추가·완료·날짜 변경이 파일 DB 를 닫았다 다시 열어도 남는다. 사용자 DB 는 쓰지 않는다.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('C2 persistence in a file database', () => {
  it('add, complete and move survive closing and reopening the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'octopus-c2-'))
    dirs.push(dir)
    const path = join(dir, 'octopus.sqlite')
    const now = new Date(2026, 10, 24, 12)

    let db = openDatabase(path)
    runMigrations(db, migrations)
    let repo = createTaskRepository(db, { now: () => now })
    const added = repo.create({ title: '파일 저장 확인', date: '2026-11-25', time: '09:15' })
    const other = repo.create({ title: '완료할 것', date: '2026-11-24' })
    repo.setStatus(other.id, 'done')
    repo.update(added.id, { date: '2026-11-26' })
    db.close()

    db = openDatabase(path)
    repo = createTaskRepository(db, { now: () => now })
    const moved = repo.get(added.id)
    expect(moved?.title).toBe('파일 저장 확인')
    expect(moved?.date).toBe('2026-11-26')
    expect(moved?.time).toBe('09:15')
    expect(repo.get(other.id)?.status).toBe('done')
    expect(repo.listRange('2026-11-25', '2026-11-25')).toEqual([])
    db.close()
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/core/db/connection'
import { migrations } from '../../src/main/core/db/migrations'
import { runMigrations } from '../../src/main/core/db/migrate'
import { createShortcutRepository } from '../../src/main/core/shortcuts/shortcutRepository'

// S1-06: 이름·순서·실행 승인 상태가 파일 DB 를 닫았다 다시 열어도 남는다. 사용자 DB 는 쓰지 않는다.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('S1 shortcut persistence in a file database', () => {
  it('rename, reorder and program approval survive closing and reopening the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'octopus-s1-'))
    dirs.push(dir)
    const path = join(dir, 'octopus.sqlite')
    const now = new Date(2026, 10, 24, 12)

    let db = openDatabase(path)
    runMigrations(db, migrations)
    let repo = createShortcutRepository(db, { now: () => now })
    const link = repo.createUrl({ url: 'https://a.example', label: 'A' })
    const program = repo.createPath({ path: join(dir, 'tool.exe'), pathType: 'file' })
    const folder = repo.createPath({ path: join(dir, 'work'), pathType: 'folder', label: '작업' })
    repo.rename(link.id, '새 이름')
    repo.move(folder.id, 'up')
    repo.setAllowed(program.id)
    db.close()

    db = openDatabase(path)
    repo = createShortcutRepository(db, { now: () => now })
    const list = repo.list()
    expect(list.map((s) => s.label)).toEqual(['새 이름', '작업', 'tool.exe'])
    expect(list.find((s) => s.id === program.id)?.allowed).toBe(true)
    expect(list.find((s) => s.id === link.id)?.allowed).toBe(false)
    db.close()
  })
})

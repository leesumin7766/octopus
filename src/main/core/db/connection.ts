import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * SQLite 연결을 연다. 파일 DB 는 WAL 로 전환한다.
 * ':memory:' 는 WAL 을 쓸 수 없으므로 foreign_keys 만 켠다.
 */
export function openDatabase(path: string): DatabaseSync {
  const inMemory = path === ':memory:'
  if (!inMemory) mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    if (!inMemory) db.exec('PRAGMA journal_mode = WAL')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

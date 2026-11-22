import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  /** 1 부터 시작하는 번호. 목록 안에서 오름차순이고 겹치지 않아야 한다. */
  version: number
  name: string
  up: (db: DatabaseSync) => void
}

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

function assertValid(migrations: readonly Migration[]): void {
  let previous = 0
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || m.version <= previous) {
      throw new Error(`invalid migration list: version ${m.version} is not greater than ${previous}`)
    }
    previous = m.version
  }
}

/**
 * 적용 안 된 마이그레이션을 번호 순서로 실행한다.
 * 각 마이그레이션은 하나의 트랜잭션이며, 실패하면 롤백하고 버전은 그대로 둔다.
 * 반환값은 실행 후의 user_version.
 */
export function runMigrations(db: DatabaseSync, migrations: readonly Migration[]): number {
  assertValid(migrations)

  const current = readVersion(db)
  const latest = migrations.length > 0 ? migrations[migrations.length - 1].version : 0
  if (current > latest) {
    // 더 새 버전의 앱이 만든 DB. 데이터를 건드리지 않고 멈춘다.
    throw new Error(`database version ${current} is newer than this app supports (${latest})`)
  }

  for (const m of migrations) {
    if (m.version <= current) continue

    db.exec('BEGIN')
    try {
      m.up(db)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // SQLite 가 이미 트랜잭션을 되돌린 경우
      }
      throw new Error(`migration ${m.version} (${m.name}) failed`, { cause: error })
    }
  }

  return readVersion(db)
}

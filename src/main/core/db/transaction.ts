import type { DatabaseSync } from 'node:sqlite'

/**
 * fn 을 하나의 트랜잭션으로 실행한다. 예외가 나면 롤백하고 다시 던진다.
 * 이미 트랜잭션 안이면 바깥 트랜잭션에 합류한다(롤백도 바깥이 맡음).
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn()

  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // SQLite 가 이미 되돌린 경우
    }
    throw error
  }
}

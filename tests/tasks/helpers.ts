import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { createTaskRepository, type TaskRepository } from '../../src/main/core/tasks/taskRepository'

export interface TestRepo {
  db: DatabaseSync
  repo: TaskRepository
  /** 테스트가 시계를 직접 움직인다. */
  setNow(iso: string): void
}

export function createTestRepo(startIso = '2026-03-10T09:00:00.000Z'): TestRepo {
  const db = new DatabaseSync(':memory:')
  runMigrations(db, migrations)

  let current = new Date(startIso)
  const repo = createTaskRepository(db, { now: () => current })
  return {
    db,
    repo,
    setNow(iso) {
      current = new Date(iso)
    }
  }
}

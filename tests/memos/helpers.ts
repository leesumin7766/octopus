import { createMemoRepository, type MemoRepository } from '../../src/main/core/memos/memoRepository'
import type { TaskRepository } from '../../src/main/core/tasks/taskRepository'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

export interface MemoEnv {
  t: TestRepo
  memos: MemoRepository
  setNow(iso: string): void
}

/** tasks 를 바꿔 끼울 수 있다(할 일 만들기가 중간에 실패하는 경우를 시험할 때). */
export function createMemoEnv(
  startIso = new Date(2026, 2, 10, 12, 0, 0).toISOString(),
  wrapTasks: (tasks: TaskRepository) => TaskRepository = (tasks) => tasks
): MemoEnv {
  const t = createTestRepo(startIso)
  let now = new Date(startIso)
  const memos = createMemoRepository(t.db, { now: () => now, tasks: wrapTasks(t.repo) })
  return {
    t,
    memos,
    setNow(iso) {
      now = new Date(iso)
      t.setNow(iso)
    }
  }
}

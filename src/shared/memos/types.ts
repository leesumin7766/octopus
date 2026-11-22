import type { Task } from '../tasks/types'

// CLAUDE.md 4.2 의 Memo. 본문은 마크다운 원문 그대로 저장한다.
export interface Memo {
  id: string
  body: string
  pinned: boolean
  taskId: string | null
  createdAt: string
  updatedAt: string
}

/** memos:toTask 의 결과 */
export interface MemoToTaskResult {
  memo: Memo
  task: Task
}

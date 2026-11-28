import type { Task, TaskView } from './types'

/** 그 할 일이 보이는 보기. 끝낸 것·안 하기로 한 것은 완료, 날짜가 오늘 이전이거나 오늘이면 오늘(지난 할 일 포함). today 는 YYYY-MM-DD. */
export function viewOf(task: Pick<Task, 'status' | 'bucket' | 'date'>, today: string): TaskView {
  if (task.status !== 'open') return 'done'
  if (task.bucket === 'someday') return 'someday'
  if (task.date === null) return 'inbox'
  return task.date <= today ? 'today' : 'upcoming'
}

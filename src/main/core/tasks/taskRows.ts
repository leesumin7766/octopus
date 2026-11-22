import type { RepeatRule, Task, TaskBucket, TaskPriority, TaskStatus } from '../../../shared/tasks/types'

/** DB 컬럼을 Task 필드 이름으로 바꿔 읽는 SELECT. */
export const SELECT_TASKS = `
  SELECT id, title, notes, status, bucket, date, time, deadline, priority, project,
         tags, repeat, routine_id AS routineId, source, sort_order AS "order",
         created_at AS createdAt, updated_at AS updatedAt, done_at AS doneAt
  FROM tasks`

interface RawTaskRow {
  id: string
  title: string
  notes: string
  status: TaskStatus
  bucket: TaskBucket
  date: string | null
  time: string | null
  deadline: string | null
  priority: number
  project: string | null
  tags: string
  repeat: string | null
  routineId: string | null
  source: string | null
  order: number
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

export function rowToTask(row: unknown): Task {
  const raw = row as RawTaskRow
  return {
    id: raw.id,
    title: raw.title,
    notes: raw.notes,
    status: raw.status,
    bucket: raw.bucket,
    date: raw.date,
    time: raw.time,
    deadline: raw.deadline,
    priority: raw.priority as TaskPriority,
    project: raw.project,
    tags: JSON.parse(raw.tags) as string[],
    repeat: raw.repeat === null ? null : (JSON.parse(raw.repeat) as RepeatRule),
    routineId: raw.routineId,
    source: raw.source === null ? null : (JSON.parse(raw.source) as Task['source']),
    order: raw.order,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    doneAt: raw.doneAt
  }
}

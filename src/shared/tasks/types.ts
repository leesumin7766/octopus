// CLAUDE.md 4.2 의 Task 모델. main·renderer 공용.

export type TaskStatus = 'open' | 'done' | 'canceled'
export type TaskBucket = 'inbox' | 'scheduled' | 'someday'
export type TaskPriority = 0 | 1 | 2 | 3

/** 반복 규칙(RRULE 부분집합). 정의만 있고 계산은 아직 없다. */
export interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  /** 0=일 .. 6=토 */
  byWeekday?: number[]
  byMonthDay?: number
}

export interface Task {
  id: string // ULID
  title: string
  notes: string // 마크다운, 빈 문자열 가능
  status: TaskStatus
  bucket: TaskBucket // 날짜 없음 / 날짜 있음 / 언젠가
  date: string | null // 할 날 YYYY-MM-DD (scheduled 일 때)
  time: string | null // HH:mm
  deadline: string | null // 마감일. date(할 날)와 다름
  priority: TaskPriority
  project: string | null
  tags: string[]
  repeat: RepeatRule | null
  routineId: string | null // 데일리 체크리스트에서 생긴 항목
  source: { arm: string; ref: string; url?: string } | null // Arm 에서 온 경우 원본 위치
  order: number
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

/** 사용자가 직접 고치는 필드. id·status·order·시각은 저장소가 관리한다. */
export type TaskFields = Pick<
  Task,
  | 'title'
  | 'notes'
  | 'bucket'
  | 'date'
  | 'time'
  | 'deadline'
  | 'priority'
  | 'project'
  | 'tags'
  | 'repeat'
  | 'routineId'
  | 'source'
>

export const TASK_FIELD_KEYS = [
  'title',
  'notes',
  'bucket',
  'date',
  'time',
  'deadline',
  'priority',
  'project',
  'tags',
  'repeat',
  'routineId',
  'source'
] as const satisfies readonly (keyof TaskFields)[]

/** 만들 때 받는 입력. 제목만 필수이고 나머지는 기본값이 있다. */
export type TaskInput = Partial<TaskFields> & { title: string }

export type TaskView = 'inbox' | 'today' | 'upcoming' | 'someday' | 'done'

export interface TodayView {
  /** date < 오늘 */
  overdue: Task[]
  /** date = 오늘 */
  today: Task[]
}

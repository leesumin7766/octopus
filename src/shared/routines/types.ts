// 데일리 체크리스트(루틴). 오늘의 항목은 routineId 가 채워진 Task 로 만들어 둔다.

export interface Routine {
  id: string
  title: string
  /** 반복할 요일. 0=일 .. 6=토, 7개가 다 있으면 매일. */
  days: number[]
  active: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface RoutineInput {
  title: string
  days: number[]
  active?: boolean
}

export type RoutinePatch = Partial<Pick<Routine, 'title' | 'days' | 'active'>>

export const ROUTINE_FIELD_KEYS = ['title', 'days', 'active'] as const

/** 'done' 완료 / 'open' 그날 항목이 있었지만 끝내지 않음 / 'none' 항목 없음 */
export type RoutineCell = 'done' | 'open' | 'none'

export interface RoutineHistoryRow {
  id: string
  title: string
  active: boolean
  days: number[]
  /** dates 와 같은 순서 */
  cells: RoutineCell[]
}

export interface RoutineHistory {
  /** 오래된 날짜부터 오늘까지 */
  dates: string[]
  routines: RoutineHistoryRow[]
}

export const DEFAULT_HISTORY_DAYS = 14
export const MAX_HISTORY_DAYS = 90

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

/**
 * 격자 한 칸: done 완료 · missed 앱은 켰는데 못 함 · pending 오늘 진행 중 ·
 * closed 그날 앱을 켜지 않아 기록이 없음 · none 해당 없음
 */
export type RoutineCell = 'done' | 'missed' | 'pending' | 'closed' | 'none'

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

import type { Task } from '../tasks/types'

/** routines:list 의 결과: 모든 루틴과 오늘 날짜의 루틴 항목(체크는 이 할 일의 status) */
export interface RoutineListData {
  routines: Routine[]
  todayItems: Task[]
}

export const DEFAULT_HISTORY_DAYS = 14
export const MAX_HISTORY_DAYS = 90

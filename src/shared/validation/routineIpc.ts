import type { MoveDirection } from '../shortcuts/types'
import {
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
  ROUTINE_FIELD_KEYS,
  type RoutineInput,
  type RoutinePatch
} from '../routines/types'
import { bad, good, isPlainObject, type Parsed } from './taskIpc'

// 루틴 IPC 입력 검사. 값의 세부 검사(요일 범위·제목 길이 등)는 저장소가 한다.

const KEYS: ReadonlySet<string> = new Set(ROUTINE_FIELD_KEYS)

function onlyKnownKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => KEYS.has(key))
}

/** 새 루틴 입력: 알려진 필드만 허용하고 제목(문자열)과 요일(배열)은 필수. */
export function parseRoutineInput(value: unknown): Parsed<RoutineInput> {
  if (!isPlainObject(value) || !onlyKnownKeys(value)) return bad('input')
  if (typeof value['title'] !== 'string') return bad('title')
  if (!Array.isArray(value['days'])) return bad('days')
  return good(value as unknown as RoutineInput)
}

export function parseRoutinePatch(value: unknown): Parsed<RoutinePatch> {
  if (!isPlainObject(value) || !onlyKnownKeys(value)) return bad('patch')
  return good(value as RoutinePatch)
}

/** 순서 바꾸기 방향: 'up' 또는 'down' 만. */
export function parseMoveDirection(value: unknown): Parsed<MoveDirection> {
  return value === 'up' || value === 'down' ? good(value) : bad('direction')
}

/** 기록 조회 일수. 생략하면 기본값(14). */
export function parseHistoryDays(value: unknown): Parsed<number> {
  if (value === undefined || value === null) return good(DEFAULT_HISTORY_DAYS)
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_HISTORY_DAYS) return bad('days')
  return good(value)
}

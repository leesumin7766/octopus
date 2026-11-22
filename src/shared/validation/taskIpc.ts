import {
  TASK_FIELD_KEYS,
  type TaskFields,
  type TaskInput,
  type TaskStatus,
  type TaskView
} from '../tasks/types'

// 렌더러에서 IPC 로 들어오는 값을 사용 전에 검사한다. 입력은 타입을 믿을 수 없다.

export const MAX_IDS = 500
export const MAX_TEXT_LENGTH = 1000

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
const VIEWS: readonly unknown[] = ['inbox', 'today', 'upcoming', 'someday', 'done']
const STATUSES: readonly unknown[] = ['open', 'done', 'canceled']
// routineId 는 루틴 쪽 코드가 정하는 값이라 렌더러가 보내는 입력·수정에서는 받지 않는다.
const FIELD_KEYS: ReadonlySet<string> = new Set(TASK_FIELD_KEYS.filter((key) => key !== 'routineId'))

/** 성공하면 값, 실패하면 틀린 필드 이름(입력값은 담지 않음). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string }

export function good<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

export function bad(field: string): Parsed<never> {
  return { ok: false, field }
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

export function parseView(value: unknown): Parsed<TaskView> {
  return VIEWS.includes(value) ? good(value as TaskView) : bad('view')
}

export function parseId(value: unknown): Parsed<string> {
  return isUlid(value) ? good(value) : bad('id')
}

export function parseIds(value: unknown): Parsed<string[]> {
  if (!Array.isArray(value) || value.length > MAX_IDS || !value.every(isUlid)) return bad('ids')
  return good(value as string[])
}

export function parseText(value: unknown): Parsed<string> {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? good(value) : bad('text')
}

export function parseStatus(value: unknown): Parsed<TaskStatus> {
  return STATUSES.includes(value) ? good(value as TaskStatus) : bad('status')
}

function hasOnlyKnownFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => FIELD_KEYS.has(key))
}

/** 새 할 일 입력: 알려진 필드만 허용하고 제목은 필수. 값의 세부 검사는 저장소가 한다. */
export function parseTaskInput(value: unknown): Parsed<TaskInput> {
  if (!isPlainObject(value) || !hasOnlyKnownFields(value)) return bad('input')
  if (typeof value['title'] !== 'string') return bad('title')
  return good(value as unknown as TaskInput)
}

/** 고칠 필드 묶음: 모르는 필드가 있으면 거부. 값의 세부 검사는 저장소가 한다. */
export function parseTaskPatch(value: unknown): Parsed<Partial<TaskFields>> {
  if (!isPlainObject(value) || !hasOnlyKnownFields(value)) return bad('patch')
  return good(value as Partial<TaskFields>)
}

import { isUlid } from '../validation/taskIpc'

// 원형 메뉴 칸이 실행할 수 있는 동작(액션)의 목록과 8칸 설정의 검사. 순수 함수만 있다.

/** 이름이 정해진 액션. 바로가기는 따로 'shortcut:<id>' 모양. */
export const FIXED_ACTIONS = [
  'nav:home',
  'nav:tasks',
  'nav:routines',
  'nav:memos',
  'nav:settings',
  'task:quickAdd',
  'memo:quickAdd',
  'command',
  'arm:google-calendar',
  'arm:mail',
  'arm:obsidian',
  'wiki',
  'arms'
] as const

export type FixedAction = (typeof FIXED_ACTIONS)[number]
export type ShortcutAction = `shortcut:${string}`
export type ActionId = FixedAction | ShortcutAction

export const SHORTCUT_PREFIX = 'shortcut:'

/** 원형 메뉴의 칸 수 */
export const PIE_SLOT_COUNT = 8

/** 기본 8칸: 12시부터 시계 방향으로 지시하기 · 할 일 추가 · 캘린더 · 메일 · 메모 · 위키 · 옵시디언 · Arms */
export const DEFAULT_PIE_SLOTS: readonly ActionId[] = [
  'command',
  'task:quickAdd',
  'arm:google-calendar',
  'arm:mail',
  'memo:quickAdd',
  'wiki',
  'arm:obsidian',
  'arms'
]

export function shortcutAction(shortcutId: string): ShortcutAction {
  return `${SHORTCUT_PREFIX}${shortcutId}`
}

/** 'shortcut:<id>' 에서 바로가기 id 를 꺼낸다. 다른 액션이면 null. */
export function shortcutIdOf(action: string): string | null {
  return action.startsWith(SHORTCUT_PREFIX) ? action.slice(SHORTCUT_PREFIX.length) : null
}

export function isActionId(value: unknown): value is ActionId {
  if (typeof value !== 'string') return false
  if ((FIXED_ACTIONS as readonly string[]).includes(value)) return true
  const id = shortcutIdOf(value)
  return id !== null && isUlid(id)
}

/** 새로 저장하는 8칸 검사: 알려진 액션 8개여야 한다. 아니면 null. */
export function parsePieSlots(raw: unknown): ActionId[] | null {
  if (!Array.isArray(raw) || raw.length !== PIE_SLOT_COUNT || !raw.every(isActionId)) return null
  return [...raw]
}

/** 저장되어 있던 8칸을 읽는다. 모르는 액션이 있거나 8개가 아니면 기본값. */
export function normalizePieSlots(raw: unknown): ActionId[] {
  return parsePieSlots(raw) ?? [...DEFAULT_PIE_SLOTS]
}

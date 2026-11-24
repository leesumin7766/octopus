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
  'arm:obsidian',
  'arms'
] as const

export type FixedAction = (typeof FIXED_ACTIONS)[number]
export type ShortcutAction = `shortcut:${string}`
export type ActionId = FixedAction | ShortcutAction

export const SHORTCUT_PREFIX = 'shortcut:'

/** 원형 메뉴의 칸 수 */
export const PIE_SLOT_COUNT = 8

/** 기본 8칸: 12시부터 시계 방향으로 지시하기 · 할 일 추가 · 캘린더 · 할 일 보기 · 메모 쓰기 · 체크리스트 · 옵시디언 · Arms */
export const DEFAULT_PIE_SLOTS: readonly ActionId[] = [
  'command',
  'task:quickAdd',
  'arm:google-calendar',
  'nav:tasks',
  'memo:quickAdd',
  'nav:routines',
  'arm:obsidian',
  'arms'
]

/** 예전 기본값에 있었지만 v0.1 에 없는 액션. 저장된 칸에 남아 있으면 그 칸만 기본값으로 바꾼다. */
export const REMOVED_ACTIONS: readonly string[] = ['arm:mail', 'wiki']

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

/**
 * 저장되어 있던 8칸을 읽는다. 8개가 아니거나 모르는 값이 있으면 전체를 기본값으로.
 * 다만 v0.1 에서 없어진 액션(REMOVED_ACTIONS)은 그 칸만 새 기본값의 같은 자리 값으로 바꾼다.
 */
export function normalizePieSlots(raw: unknown): ActionId[] {
  if (!Array.isArray(raw) || raw.length !== PIE_SLOT_COUNT) return [...DEFAULT_PIE_SLOTS]
  const migrated: ActionId[] = []
  for (const [index, value] of raw.entries()) {
    if (isActionId(value)) migrated.push(value)
    else if (typeof value === 'string' && REMOVED_ACTIONS.includes(value)) migrated.push(DEFAULT_PIE_SLOTS[index])
    else return [...DEFAULT_PIE_SLOTS]
  }
  return migrated
}

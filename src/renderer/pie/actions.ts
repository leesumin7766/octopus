import { FIXED_ACTIONS, shortcutIdOf, type ActionId, type FixedAction } from '../../shared/pie/actions'
import type { Shortcut } from '../../shared/shortcuts/types'
import { ko } from '../i18n/ko'
import type { IconName } from '../ui/Icon'

// 원형 메뉴 칸 하나를 화면에 보여 줄 때 필요한 것: 이름, 아이콘, 지금 쓸 수 있는지와 이유.

const t = ko.pie

const FIXED_ICONS: Record<FixedAction, IconName> = {
  'nav:home': 'home',
  'nav:tasks': 'tasks',
  'nav:routines': 'checklist',
  'nav:memos': 'memo',
  'nav:settings': 'settings',
  'task:quickAdd': 'plus',
  'memo:quickAdd': 'memo',
  command: 'command',
  'arm:google-calendar': 'calendar',
  'arm:mail': 'mail',
  'arm:obsidian': 'obsidian',
  wiki: 'wiki',
  arms: 'arms'
}

/**
 * 지금 쓸 수 있는 고정 액션. 아직 없는 기능(지시하기·Arm·위키)은 여기에 없고,
 * Arm 이 연결되면 연결 상태에 따라 이 목록에 들어오게 된다.
 */
export const AVAILABLE_FIXED_ACTIONS: ReadonlySet<FixedAction> = new Set<FixedAction>([
  'nav:home',
  'nav:tasks',
  'nav:routines',
  'nav:memos',
  'nav:settings',
  'task:quickAdd',
  'memo:quickAdd',
  'arms'
])

export interface SlotInfo {
  /** 칸 번호 0..7 (12시부터 시계 방향) */
  index: number
  action: ActionId
  label: string
  icon: IconName
  enabled: boolean
  /** 쓸 수 없을 때, 가리키면 보여 줄 이유 */
  reason?: string
}

function isFixed(action: ActionId): action is FixedAction {
  return (FIXED_ACTIONS as readonly string[]).includes(action)
}

function shortcutIcon(shortcut: Shortcut): IconName {
  if (shortcut.kind === 'url') return 'link'
  return shortcut.pathType === 'folder' ? 'folder' : 'file'
}

/** 칸 하나의 표시 정보. 지워진 바로가기는 흐리게 하고 이유를 알려 준다. */
/** 연결 상태에 따라 쓸 수 있게 되는 기능 */
export interface Capabilities {
  /** 지시하기: 모델(키 또는 서버)이 연결돼 있을 때 */
  command: boolean
  /** 캘린더: Google 캘린더가 연결돼 있을 때 */
  calendar?: boolean
}

export function describeAction(action: ActionId, index: number, shortcuts: readonly Shortcut[], capabilities: Capabilities = { command: false }): SlotInfo {
  if (isFixed(action)) {
    const enabled = AVAILABLE_FIXED_ACTIONS.has(action) || (action === 'command' && capabilities.command) || (action === 'arm:google-calendar' && capabilities.calendar === true)
    const reasons = t.reasons as Record<string, string>
    return {
      index,
      action,
      label: t.labels[action],
      icon: FIXED_ICONS[action],
      enabled,
      reason: enabled ? undefined : reasons[action]
    }
  }

  const id = shortcutIdOf(action)
  const shortcut = shortcuts.find((candidate) => candidate.id === id)
  if (!shortcut) {
    return { index, action, label: t.deletedShortcut, icon: 'link', enabled: false, reason: t.deletedShortcutReason }
  }
  return { index, action, label: shortcut.label, icon: shortcutIcon(shortcut), enabled: true }
}

export function describeSlots(slots: readonly ActionId[], shortcuts: readonly Shortcut[], capabilities?: Capabilities): SlotInfo[] {
  return slots.map((action, index) => describeAction(action, index, shortcuts, capabilities))
}

/** 설정 화면의 목록에 쓰는 이름 */
export function longLabel(action: ActionId, shortcuts: readonly Shortcut[]): string {
  if (isFixed(action)) return t.longLabels[action]
  const shortcut = shortcuts.find((candidate) => candidate.id === shortcutIdOf(action))
  return shortcut ? t.shortcutLong(shortcut.label) : t.deletedShortcut
}

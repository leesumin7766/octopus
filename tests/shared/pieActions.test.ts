import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIE_SLOTS,
  FIXED_ACTIONS,
  isActionId,
  normalizePieSlots,
  parsePieSlots,
  PIE_SLOT_COUNT,
  shortcutAction,
  shortcutIdOf
} from '../../src/shared/pie/actions'
import { createUlidGenerator } from '../../src/shared/tasks/ulid'

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

describe('actions', () => {
  it('has the actions the pie menu can run', () => {
    expect([...FIXED_ACTIONS]).toEqual([
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
    ])
  })

  it('the default eight slots are 지시하기 · 할 일 추가 · 캘린더 · 할 일 보기 · 메모 쓰기 · 체크리스트 · 옵시디언 · Arms, clockwise from 12', () => {
    expect(PIE_SLOT_COUNT).toBe(8)
    expect([...DEFAULT_PIE_SLOTS]).toEqual([
      'command',
      'task:quickAdd',
      'arm:google-calendar',
      'nav:tasks',
      'memo:quickAdd',
      'nav:routines',
      'arm:obsidian',
      'arms'
    ])
    expect(DEFAULT_PIE_SLOTS.every(isActionId)).toBe(true)
  })

  it('no longer accepts the removed mail and wiki actions', () => {
    expect(isActionId('arm:mail')).toBe(false)
    expect(isActionId('wiki')).toBe(false)
  })

  it('isActionId accepts fixed actions and shortcut:<ULID>, nothing else', () => {
    for (const action of FIXED_ACTIONS) expect(isActionId(action)).toBe(true)
    expect(isActionId(shortcutAction(ID))).toBe(true)
    expect(isActionId(shortcutAction(createUlidGenerator()(Date.now())))).toBe(true)

    for (const value of ['shortcut:', 'shortcut:abc', `shortcut:${ID}x`, `shortcut:${ID.toLowerCase()}`, 'nav:nowhere', 'NAV:HOME', 'command ', '', 5, null, undefined, {}]) {
      expect(isActionId(value)).toBe(false)
    }
  })

  it('shortcutAction and shortcutIdOf are inverses', () => {
    expect(shortcutIdOf(shortcutAction(ID))).toBe(ID)
    expect(shortcutIdOf('command')).toBeNull()
  })
})

describe('pie slots', () => {
  const eight = (...overrides: string[]) => [...DEFAULT_PIE_SLOTS.slice(0, 8 - overrides.length), ...overrides]

  it('accepts eight known actions, including shortcuts and repeats', () => {
    expect(parsePieSlots([...DEFAULT_PIE_SLOTS])).toEqual([...DEFAULT_PIE_SLOTS])
    expect(parsePieSlots(eight(shortcutAction(ID)))).toEqual(eight(shortcutAction(ID)))
    expect(parsePieSlots(Array(8).fill('nav:home'))).toEqual(Array(8).fill('nav:home'))
  })

  it('rejects the wrong number of slots, unknown actions and wrong types', () => {
    expect(parsePieSlots([])).toBeNull()
    expect(parsePieSlots(DEFAULT_PIE_SLOTS.slice(0, 7))).toBeNull()
    expect(parsePieSlots([...DEFAULT_PIE_SLOTS, 'nav:home'])).toBeNull()
    expect(parsePieSlots(eight('nav:nowhere'))).toBeNull()
    expect(parsePieSlots(eight('shortcut:nope'))).toBeNull()
    expect(parsePieSlots(eight(5 as unknown as string))).toBeNull()
    for (const value of ['command', null, undefined, {}, 8]) expect(parsePieSlots(value)).toBeNull()
  })

  it('normalizePieSlots falls back to the defaults for anything invalid', () => {
    const custom = eight('nav:settings')
    expect(normalizePieSlots(custom)).toEqual(custom)
    expect(normalizePieSlots(eight('nav:nowhere'))).toEqual([...DEFAULT_PIE_SLOTS])
    expect(normalizePieSlots(undefined)).toEqual([...DEFAULT_PIE_SLOTS])
  })

  it('migrates a removed action (mail, wiki) to the default of that same slot only', () => {
    const saved = ['nav:settings', 'nav:home', 'arm:mail', 'nav:memos', 'task:quickAdd', 'memo:quickAdd', 'wiki', 'nav:tasks']
    expect(normalizePieSlots(saved)).toEqual(['nav:settings', 'nav:home', 'arm:google-calendar', 'nav:memos', 'task:quickAdd', 'memo:quickAdd', 'arm:obsidian', 'nav:tasks'])
  })

  it('a removed action does not rescue a slot list with some other unknown value', () => {
    expect(normalizePieSlots(eight('arm:mail', 'nav:nowhere'))).toEqual([...DEFAULT_PIE_SLOTS])
  })

  it('normalizePieSlots returns a fresh array each time', () => {
    const a = normalizePieSlots(undefined)
    a[0] = 'nav:home'
    expect(normalizePieSlots(undefined)[0]).toBe('command')
  })
})

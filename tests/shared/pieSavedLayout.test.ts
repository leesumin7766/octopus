import { describe, expect, it } from 'vitest'
import { DEFAULT_PIE_SLOTS, normalizePieSlots, parsePieSlots, type ActionId } from '../../src/shared/pie/actions'

// C1 보완: 기본 칸이 바뀌어도 이미 저장된 사용자 8칸은 그대로 읽힌다.

/** 이전 기본값(3번 칸이 Google 웹 열기)으로 사용자가 저장해 둔 8칸 */
const SAVED_BEFORE_CHANGE: ActionId[] = [
  'command',
  'task:quickAdd',
  'arm:google-calendar',
  'arm:mail',
  'memo:quickAdd',
  'wiki',
  'arm:obsidian',
  'arms'
]

describe('saved pie layouts survive the new default', () => {
  it('a saved layout that still has the Google wedge keeps it at position 3', () => {
    expect(parsePieSlots(SAVED_BEFORE_CHANGE)).toEqual(SAVED_BEFORE_CHANGE)
    expect(normalizePieSlots(SAVED_BEFORE_CHANGE)).toEqual(SAVED_BEFORE_CHANGE)
  })

  it('only a layout that was never saved takes the new default (local calendar at position 3)', () => {
    expect(normalizePieSlots(undefined)[2]).toBe('calendar:local')
    expect(DEFAULT_PIE_SLOTS[2]).toBe('calendar:local')
    expect(normalizePieSlots(undefined)).toEqual([...DEFAULT_PIE_SLOTS])
  })

  it('the Google web action stays selectable: it is still a known action', () => {
    expect(parsePieSlots(['arm:google-calendar', ...SAVED_BEFORE_CHANGE.slice(1)])).not.toBeNull()
  })
})

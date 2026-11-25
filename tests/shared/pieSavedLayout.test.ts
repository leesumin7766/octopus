import { describe, expect, it } from 'vitest'
import { DEFAULT_PIE_SLOTS, normalizePieSlots, parsePieSlots } from '../../src/shared/pie/actions'

// C1 보완: 기본 칸이 바뀌어도 이미 저장된 사용자 8칸은 그대로 읽힌다.
// origin/dev 병합 뒤: v0.1 에서 없어진 메일·위키 칸만 그 자리의 새 기본값으로 바뀌고, 나머지(Google 칸 포함)는 그대로다.

/** 이전 기본값(3번 칸이 Google 웹 열기, 메일·위키 포함)으로 사용자가 저장해 둔 8칸 */
const SAVED_BEFORE_CHANGE: string[] = [
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
  it('a saved layout that still has the Google wedge keeps it at position 3; only removed wedges move', () => {
    expect(normalizePieSlots(SAVED_BEFORE_CHANGE)).toEqual([
      'command',
      'task:quickAdd',
      'arm:google-calendar',
      DEFAULT_PIE_SLOTS[3],
      'memo:quickAdd',
      DEFAULT_PIE_SLOTS[5],
      'arm:obsidian',
      'arms'
    ])
  })

  it('only a layout that was never saved takes the new default (local calendar at position 3)', () => {
    expect(normalizePieSlots(undefined)[2]).toBe('calendar:local')
    expect(DEFAULT_PIE_SLOTS[2]).toBe('calendar:local')
    expect(normalizePieSlots(undefined)).toEqual([...DEFAULT_PIE_SLOTS])
  })

  it('the Google web action stays selectable: it is still a known action', () => {
    const layout = [...DEFAULT_PIE_SLOTS]
    layout[2] = 'arm:google-calendar'
    expect(parsePieSlots(layout)).toEqual(layout)
    expect(normalizePieSlots(layout)).toEqual(layout)
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEAD_ZONE_PX,
  isTap,
  OUTER_RADIUS_PX,
  releaseOutcome,
  slotAngles,
  slotCenterAngle,
  slotCenterPoint,
  slotFromPoint,
  stepSlot,
  TAP_DISTANCE_PX,
  TAP_MS
} from '../../src/shared/pie/geometry'

describe('slotFromPoint', () => {
  it('0 is the 12 o\'clock wedge and numbers grow clockwise', () => {
    expect(slotFromPoint(0, -100)).toBe(0) // 위
    expect(slotFromPoint(100, 0)).toBe(2) // 오른쪽
    expect(slotFromPoint(0, 100)).toBe(4) // 아래
    expect(slotFromPoint(-100, 0)).toBe(6) // 왼쪽
  })

  it('every wedge is found from its own center direction, at several distances', () => {
    for (let slot = 0; slot < 8; slot++) {
      for (const radius of [DEAD_ZONE_PX + 4, 104, 150, OUTER_RADIUS_PX - 1]) {
        const { x, y } = slotCenterPoint(slot, radius)
        expect(slotFromPoint(x, y)).toBe(slot)
      }
    }
  })

  it('a wedge is 45 degrees wide: points just inside each edge belong to that wedge', () => {
    for (let slot = 0; slot < 8; slot++) {
      const { start, end } = slotAngles(slot)
      for (const [angle, expected] of [[start + 1, slot], [end - 1, slot]] as const) {
        const radians = (angle * Math.PI) / 180
        expect(slotFromPoint(100 * Math.cos(radians), 100 * Math.sin(radians))).toBe(expected)
      }
    }
  })

  it('the edge between two wedges belongs to the clockwise one', () => {
    expect(slotFromPoint(100, -100)).toBe(1) // 12시와 3시 사이의 -45도
    expect(slotFromPoint(100, 100)).toBe(3)
    expect(slotFromPoint(-100, 100)).toBe(5)
    expect(slotFromPoint(-100, -100)).toBe(7)
  })

  it('there is no selection in the dead zone near the center, or far outside', () => {
    expect(slotFromPoint(0, 0)).toBeNull()
    expect(slotFromPoint(10, -10)).toBeNull()
    expect(slotFromPoint(0, -(DEAD_ZONE_PX - 1))).toBeNull()
    expect(slotFromPoint(0, -DEAD_ZONE_PX)).toBe(0) // 경계 바로 바깥은 선택된다
    expect(slotFromPoint(0, -OUTER_RADIUS_PX)).toBe(0)
    expect(slotFromPoint(0, -(OUTER_RADIUS_PX + 1))).toBeNull()
    expect(slotFromPoint(1000, 1000)).toBeNull()
  })

  it('the dead zone and outer radius can be changed', () => {
    expect(slotFromPoint(0, -20, 10, 50)).toBe(0)
    expect(slotFromPoint(0, -5, 10, 50)).toBeNull()
    expect(slotFromPoint(0, -60, 10, 50)).toBeNull()
  })

  it('does not select anything for a point that is not a number', () => {
    expect(slotFromPoint(NaN, 10)).toBeNull()
    expect(slotFromPoint(Infinity, 0)).toBeNull()
  })
})

describe('slot angles', () => {
  it('start at -90 (12 o\'clock) and step 45 degrees', () => {
    expect(slotAngles(0)).toEqual({ start: -90, end: -45 })
    expect(slotAngles(2)).toEqual({ start: 0, end: 45 })
    expect(slotAngles(7)).toEqual({ start: 225, end: 270 })
    expect(slotCenterAngle(0)).toBe(-67.5)
    expect(slotCenterAngle(4)).toBe(112.5)
  })
})

describe('stepSlot', () => {
  it('moves and wraps around the ring in both directions', () => {
    expect(stepSlot(0, 1)).toBe(1)
    expect(stepSlot(7, 1)).toBe(0)
    expect(stepSlot(0, -1)).toBe(7)
    expect(stepSlot(3, -1)).toBe(2)
    expect(stepSlot(2, 8)).toBe(2)
    expect(stepSlot(2, -10)).toBe(0)
  })
})

describe('press gestures', () => {
  it('a press is a tap when it barely moves and is quick', () => {
    expect(isTap(0, 0)).toBe(true)
    expect(isTap(TAP_DISTANCE_PX - 1, TAP_MS - 1)).toBe(true)
    expect(isTap(TAP_DISTANCE_PX, 10)).toBe(false) // 충분히 움직임
    expect(isTap(2, TAP_MS)).toBe(false) // 오래 누름
  })

  it('releasing over a wedge runs it, however the press went', () => {
    expect(releaseOutcome({ slot: 3, distance: 90, durationMs: 800, wasOpen: false })).toBe('run')
    expect(releaseOutcome({ slot: 0, distance: 2, durationMs: 10, wasOpen: true })).toBe('run')
  })

  it('a quick tap on the circle opens the menu and keeps it open', () => {
    expect(releaseOutcome({ slot: null, distance: 1, durationMs: 80, wasOpen: false })).toBe('keep-open')
  })

  it('a quick tap on the circle while the menu is open closes it', () => {
    expect(releaseOutcome({ slot: null, distance: 1, durationMs: 80, wasOpen: true })).toBe('close')
  })

  it('dragging out and releasing in empty space (or the dead zone) closes the menu', () => {
    expect(releaseOutcome({ slot: null, distance: 120, durationMs: 500, wasOpen: false })).toBe('close')
    expect(releaseOutcome({ slot: null, distance: 20, durationMs: 100, wasOpen: false })).toBe('close')
  })

  it('a long press without moving closes the menu too', () => {
    expect(releaseOutcome({ slot: null, distance: 0, durationMs: 900, wasOpen: false })).toBe('close')
  })
})

import { describe, expect, it } from 'vitest'
import {
  CARD_IDS,
  clampRatio,
  defaultLayout,
  moveCard,
  movableDirections,
  neighborPosition,
  normalizeLayout,
  parseLayout,
  positionOf,
  ratioFromPointer,
  resetRatios,
  sameLayout,
  setCol,
  setRow,
  stepRatio,
  type CardId,
  type HomeLayout
} from '../../src/shared/home/layout'

const order = (layout: HomeLayout): CardId[] => layout.order

describe('default layout', () => {
  it('has the four cards in the default order and 50/50 ratios', () => {
    expect(defaultLayout()).toEqual({ version: 1, order: ['todo', 'calendar', 'memo', 'shortcuts'], col: 50, row: 50 })
    expect(CARD_IDS).toEqual(['todo', 'calendar', 'memo', 'shortcuts'])
  })

  it('returns a fresh object each time', () => {
    const a = defaultLayout()
    a.order.reverse()
    expect(defaultLayout().order[0]).toBe('todo')
  })
})

describe('ratios', () => {
  it('are limited to 25-75 and rounded', () => {
    expect(clampRatio(50)).toBe(50)
    expect(clampRatio(10)).toBe(25)
    expect(clampRatio(24.4)).toBe(25)
    expect(clampRatio(90)).toBe(75)
    expect(clampRatio(75.4)).toBe(75)
    expect(clampRatio(33.6)).toBe(34)
    expect(clampRatio(NaN)).toBe(50)
    expect(clampRatio(Infinity)).toBe(50)
  })

  it('setCol and setRow clamp too, and leave the rest alone', () => {
    const layout = defaultLayout()

    expect(setCol(layout, 5)).toEqual({ ...layout, col: 25 })
    expect(setCol(layout, 62)).toEqual({ ...layout, col: 62 })
    expect(setRow(layout, 99)).toEqual({ ...layout, row: 75 })
    expect(setRow(layout, 40)).toEqual({ ...layout, row: 40 })
  })

  it('a double click (resetRatios) puts both back to 50/50 and keeps the card order', () => {
    const changed = { ...moveCard(defaultLayout(), 'todo', 'right'), col: 70, row: 30 }

    const reset = resetRatios(changed)

    expect(reset).toMatchObject({ col: 50, row: 50 })
    expect(order(reset)).toEqual(order(changed))
  })

  it('stepRatio moves 5 at a time and stops at the limits', () => {
    expect(stepRatio(50, 1)).toBe(55)
    expect(stepRatio(50, -1)).toBe(45)
    expect(stepRatio(75, 1)).toBe(75)
    expect(stepRatio(25, -1)).toBe(25)
    expect(stepRatio(73, 1)).toBe(75)
  })

  it('ratioFromPointer turns a pointer offset into a clamped percentage', () => {
    expect(ratioFromPointer(500, 1000)).toBe(50)
    expect(ratioFromPointer(300, 1000)).toBe(30)
    expect(ratioFromPointer(50, 1000)).toBe(25)
    expect(ratioFromPointer(990, 1000)).toBe(75)
    expect(ratioFromPointer(-40, 1000)).toBe(25)
  })

  it('ratioFromPointer gives null when the size is unknown', () => {
    expect(ratioFromPointer(10, 0)).toBeNull()
    expect(ratioFromPointer(10, -5)).toBeNull()
    expect(ratioFromPointer(NaN, 100)).toBeNull()
  })
})

describe('positions and neighbors', () => {
  //  0 1
  //  2 3
  it('neighbors in the four directions, none past the edge', () => {
    expect(neighborPosition(0, 'right')).toBe(1)
    expect(neighborPosition(0, 'down')).toBe(2)
    expect(neighborPosition(0, 'left')).toBeNull()
    expect(neighborPosition(0, 'up')).toBeNull()
    expect(neighborPosition(1, 'left')).toBe(0)
    expect(neighborPosition(1, 'down')).toBe(3)
    expect(neighborPosition(1, 'right')).toBeNull()
    expect(neighborPosition(1, 'up')).toBeNull()
    expect(neighborPosition(2, 'up')).toBe(0)
    expect(neighborPosition(2, 'right')).toBe(3)
    expect(neighborPosition(2, 'left')).toBeNull()
    expect(neighborPosition(2, 'down')).toBeNull()
    expect(neighborPosition(3, 'up')).toBe(1)
    expect(neighborPosition(3, 'left')).toBe(2)
    expect(neighborPosition(3, 'right')).toBeNull()
    expect(neighborPosition(3, 'down')).toBeNull()
  })

  it('each position can move in exactly two directions', () => {
    expect(movableDirections(0).sort()).toEqual(['down', 'right'])
    expect(movableDirections(1).sort()).toEqual(['down', 'left'])
    expect(movableDirections(2).sort()).toEqual(['right', 'up'])
    expect(movableDirections(3).sort()).toEqual(['left', 'up'])
  })

  it('positionOf finds the slot of a card', () => {
    const layout = defaultLayout()
    expect(CARD_IDS.map((card) => positionOf(layout, card))).toEqual([0, 1, 2, 3])
  })
})

describe('moveCard (swap with the neighbor)', () => {
  it('right / left / down / up each swap with that neighbor', () => {
    const layout = defaultLayout() // todo calendar / memo shortcuts

    expect(order(moveCard(layout, 'todo', 'right'))).toEqual(['calendar', 'todo', 'memo', 'shortcuts'])
    expect(order(moveCard(layout, 'calendar', 'left'))).toEqual(['calendar', 'todo', 'memo', 'shortcuts'])
    expect(order(moveCard(layout, 'todo', 'down'))).toEqual(['memo', 'calendar', 'todo', 'shortcuts'])
    expect(order(moveCard(layout, 'memo', 'up'))).toEqual(['memo', 'calendar', 'todo', 'shortcuts'])
    expect(order(moveCard(layout, 'calendar', 'down'))).toEqual(['todo', 'shortcuts', 'memo', 'calendar'])
    expect(order(moveCard(layout, 'shortcuts', 'up'))).toEqual(['todo', 'shortcuts', 'memo', 'calendar'])
    expect(order(moveCard(layout, 'memo', 'right'))).toEqual(['todo', 'calendar', 'shortcuts', 'memo'])
    expect(order(moveCard(layout, 'shortcuts', 'left'))).toEqual(['todo', 'calendar', 'shortcuts', 'memo'])
  })

  it('does nothing at an edge and returns the same object', () => {
    const layout = defaultLayout()

    expect(moveCard(layout, 'todo', 'up')).toBe(layout)
    expect(moveCard(layout, 'todo', 'left')).toBe(layout)
    expect(moveCard(layout, 'calendar', 'right')).toBe(layout)
    expect(moveCard(layout, 'memo', 'down')).toBe(layout)
    expect(moveCard(layout, 'shortcuts', 'right')).toBe(layout)
  })

  it('keeps the ratios, never changes the input, and always leaves every card exactly once', () => {
    const layout: HomeLayout = { ...defaultLayout(), col: 60, row: 40 }
    const before = JSON.stringify(layout)

    const moved = moveCard(moveCard(layout, 'todo', 'right'), 'todo', 'down')

    expect(JSON.stringify(layout)).toBe(before)
    expect(moved).toMatchObject({ col: 60, row: 40 })
    expect([...moved.order].sort()).toEqual([...CARD_IDS].sort())
  })

  it('moving back undoes a move', () => {
    const layout = defaultLayout()

    expect(moveCard(moveCard(layout, 'todo', 'right'), 'todo', 'left')).toEqual(layout)
  })

  it('does nothing for a card that is not in the layout', () => {
    const layout = defaultLayout()

    expect(moveCard(layout, 'nope' as CardId, 'right')).toBe(layout)
  })
})

describe('stored format', () => {
  it('survives a JSON round trip', () => {
    const layout: HomeLayout = { version: 1, order: ['memo', 'todo', 'shortcuts', 'calendar'], col: 62, row: 35 }

    expect(normalizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
    expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it('falls back to the default for anything that is not a valid layout', () => {
    const good = { version: 1, order: ['todo', 'calendar', 'memo', 'shortcuts'], col: 50, row: 50 }
    const bad: unknown[] = [
      null,
      undefined,
      'layout',
      42,
      [],
      {},
      { ...good, version: 2 },
      { ...good, version: undefined },
      { ...good, order: ['todo', 'calendar', 'memo'] }, // 카드 빠짐
      { ...good, order: ['todo', 'todo', 'memo', 'shortcuts'] }, // 겹침
      { ...good, order: ['todo', 'calendar', 'memo', 'mail'] }, // 모르는 카드
      { ...good, order: 'todo' },
      { ...good, col: '50' },
      { ...good, row: null },
      { ...good, col: NaN },
      { ...good, row: Infinity }
    ]

    for (const value of bad) {
      expect(parseLayout(value)).toBeNull()
      expect(normalizeLayout(value)).toEqual(defaultLayout())
    }
  })

  it('clamps stored ratios that are out of range instead of rejecting them', () => {
    const stored = { version: 1, order: ['todo', 'calendar', 'memo', 'shortcuts'], col: 5, row: 200 }

    expect(parseLayout(stored)).toEqual({ ...stored, col: 25, row: 75 })
  })

  it('does not keep unknown extra fields', () => {
    const stored = { version: 1, order: ['todo', 'calendar', 'memo', 'shortcuts'], col: 50, row: 50, extra: 'x' }

    expect(parseLayout(stored)).toEqual(defaultLayout())
  })

  it('sameLayout compares order and ratios', () => {
    expect(sameLayout(defaultLayout(), defaultLayout())).toBe(true)
    expect(sameLayout(defaultLayout(), setCol(defaultLayout(), 60))).toBe(false)
    expect(sameLayout(defaultLayout(), moveCard(defaultLayout(), 'todo', 'right'))).toBe(false)
  })
})

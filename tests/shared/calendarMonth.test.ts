import { describe, expect, it } from 'vitest'
import { gridRange, monthGridDates, monthOf, shiftMonth } from '../../src/shared/calendar/month'

// C1-06: 월·연도 경계, 윤년, 42칸(6주) 격자. 날짜는 모두 YYYY-MM-DD 문자열이다.

describe('month grid', () => {
  it('November 2026 starts on the Sunday on or before the 1st and always has 42 cells', () => {
    const cells = monthGridDates({ year: 2026, month: 11 }) // 2026-11-01 은 일요일
    expect(cells).toHaveLength(42)
    expect(cells[0]).toBe('2026-11-01')
    expect(cells.at(-1)).toBe('2026-12-12')
  })

  it('a month that starts mid-week is padded with the end of the previous month', () => {
    const cells = monthGridDates({ year: 2026, month: 12 }) // 2026-12-01 은 화요일
    expect(cells[0]).toBe('2026-11-29')
    expect(cells[2]).toBe('2026-12-01')
    expect(cells.at(-1)).toBe('2027-01-09')
  })

  it('December to January crosses the year boundary without skipping or repeating days', () => {
    const cells = monthGridDates({ year: 2026, month: 12 })
    const i = cells.indexOf('2026-12-31')
    expect(cells[i + 1]).toBe('2027-01-01')
    expect(new Set(cells).size).toBe(42)
  })

  it('February 2028 (leap year) contains the 29th and no 30th', () => {
    const cells = monthGridDates({ year: 2028, month: 2 })
    expect(cells).toContain('2028-02-29')
    expect(cells.filter((c) => c.startsWith('2028-02-')).length).toBe(29)
    expect(cells.some((c) => c === '2028-02-30')).toBe(false)
  })

  it('February 2027 (common year) ends on the 28th', () => {
    const cells = monthGridDates({ year: 2027, month: 2 })
    expect(cells.filter((c) => c.startsWith('2027-02-')).length).toBe(28)
    expect(cells).not.toContain('2027-02-29')
  })

  it('gridRange returns the first and last cell', () => {
    expect(gridRange({ year: 2026, month: 11 })).toEqual({ from: '2026-11-01', to: '2026-12-12' })
  })

  it('rejects months outside 1-12', () => {
    expect(() => monthGridDates({ year: 2026, month: 0 })).toThrow(RangeError)
    expect(() => monthGridDates({ year: 2026, month: 13 })).toThrow(RangeError)
  })
})

describe('month navigation', () => {
  it('shiftMonth wraps the year in both directions', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 })
    expect(shiftMonth({ year: 2026, month: 3 }, 9)).toEqual({ year: 2026, month: 12 })
  })

  it('monthOf reads the year and month of a date string', () => {
    expect(monthOf('2027-01-01')).toEqual({ year: 2027, month: 1 })
    expect(monthOf('2028-02-29')).toEqual({ year: 2028, month: 2 })
  })
})

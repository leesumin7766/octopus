import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysInMonth,
  formatDate,
  localDateString,
  mondayIndex,
  parseDate,
  weekdayOf
} from '../../src/shared/tasks/dates'

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-03-10', 0)).toBe('2026-03-10')
    expect(addDays('2026-03-10', 365)).toBe('2027-03-10')
  })

  it('gives the weekday (0=Sun) and Monday-based index', () => {
    expect(weekdayOf('2026-11-22')).toBe(0)
    expect(weekdayOf('2026-11-23')).toBe(1)
    expect(weekdayOf('2026-11-28')).toBe(6)
    expect([0, 1, 2, 6].map(mondayIndex)).toEqual([6, 0, 1, 5])
  })

  it('knows month lengths', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('formats and parses', () => {
    expect(formatDate(2026, 3, 5)).toBe('2026-03-05')
    expect(parseDate('2026-03-05')).toEqual({ year: 2026, month: 3, day: 5 })
    expect(() => parseDate('2026-3-5')).toThrow(RangeError)
  })

  it('uses the local calendar date', () => {
    expect(localDateString(new Date(2026, 2, 10, 0, 5))).toBe('2026-03-10')
    expect(localDateString(new Date(2026, 2, 10, 23, 55))).toBe('2026-03-10')
  })
})

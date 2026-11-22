import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatRepeat,
  isPastDate,
  msUntilNextMidnight,
  splitTags
} from '../../src/renderer/tasks/format'

describe('formatDate', () => {
  const today = '2026-03-10' // 화요일

  it('uses words near today', () => {
    expect(formatDate('2026-03-10', today)).toBe('오늘')
    expect(formatDate('2026-03-11', today)).toBe('내일')
    expect(formatDate('2026-03-09', today)).toBe('어제')
  })

  it('otherwise month/day with the weekday', () => {
    expect(formatDate('2026-03-12', today)).toBe('3/12 (목)')
    expect(formatDate('2026-02-01', today)).toBe('2/1 (일)')
  })

  it('adds the year when it is not this year', () => {
    expect(formatDate('2027-01-05', today)).toBe('2027/1/5 (화)')
  })
})

describe('formatRepeat', () => {
  it('daily / weekly / monthly / yearly', () => {
    expect(formatRepeat({ freq: 'daily', interval: 1 })).toBe('매일')
    expect(formatRepeat({ freq: 'weekly', interval: 1 })).toBe('매주')
    expect(formatRepeat({ freq: 'weekly', interval: 1, byWeekday: [5, 1, 3] })).toBe('매주 월 수 금')
    expect(formatRepeat({ freq: 'monthly', interval: 1 })).toBe('매월')
    expect(formatRepeat({ freq: 'monthly', interval: 1, byMonthDay: 15 })).toBe('매월 15일')
    expect(formatRepeat({ freq: 'yearly', interval: 1 })).toBe('매년')
  })

  it('weekdays', () => {
    expect(formatRepeat({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] })).toBe('평일')
  })

  it('intervals', () => {
    expect(formatRepeat({ freq: 'daily', interval: 2 })).toBe('2일마다')
    expect(formatRepeat({ freq: 'weekly', interval: 2, byWeekday: [1] })).toBe('2주마다 월')
    expect(formatRepeat({ freq: 'monthly', interval: 3 })).toBe('3개월마다')
    expect(formatRepeat({ freq: 'yearly', interval: 2 })).toBe('2년마다')
  })
})

describe('helpers', () => {
  it('isPastDate', () => {
    expect(isPastDate('2026-03-09', '2026-03-10')).toBe(true)
    expect(isPastDate('2026-03-10', '2026-03-10')).toBe(false)
  })

  it('msUntilNextMidnight counts to the next local midnight', () => {
    expect(msUntilNextMidnight(new Date(2026, 2, 10, 23, 59, 0))).toBe(60_000)
    expect(msUntilNextMidnight(new Date(2026, 2, 10, 0, 0, 0))).toBe(24 * 60 * 60 * 1000)
    expect(msUntilNextMidnight(new Date(2026, 11, 31, 12, 0, 0))).toBe(12 * 60 * 60 * 1000)
  })

  it('splitTags trims, drops empties and duplicates', () => {
    expect(splitTags('a, b, ,a,  c ')).toEqual(['a', 'b', 'c'])
    expect(splitTags('')).toEqual([])
  })
})

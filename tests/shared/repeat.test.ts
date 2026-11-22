import { describe, expect, it } from 'vitest'
import { firstOccurrence, nextOccurrence, nextOccurrenceFrom } from '../../src/shared/tasks/repeat'
import type { RepeatRule } from '../../src/shared/tasks/types'

const daily = (interval = 1): RepeatRule => ({ freq: 'daily', interval })
const weekly = (interval: number, byWeekday?: number[]): RepeatRule =>
  byWeekday ? { freq: 'weekly', interval, byWeekday } : { freq: 'weekly', interval }
const monthly = (interval: number, byMonthDay?: number): RepeatRule =>
  byMonthDay ? { freq: 'monthly', interval, byMonthDay } : { freq: 'monthly', interval }
const yearly = (interval = 1): RepeatRule => ({ freq: 'yearly', interval })

describe('nextOccurrence', () => {
  describe('daily', () => {
    it('every day and every other day', () => {
      expect(nextOccurrence(daily(), '2026-03-10')).toBe('2026-03-11')
      expect(nextOccurrence(daily(2), '2026-03-10')).toBe('2026-03-12')
    })

    it('crosses month and year ends', () => {
      expect(nextOccurrence(daily(), '2026-02-28')).toBe('2026-03-01')
      expect(nextOccurrence(daily(), '2026-12-31')).toBe('2027-01-01')
      expect(nextOccurrence(daily(3), '2026-12-30')).toBe('2027-01-02')
    })
  })

  describe('weekly', () => {
    // 2026-03-09 는 월요일
    const monWedFri = weekly(1, [1, 3, 5])

    it('walks through several weekdays in a week', () => {
      expect(nextOccurrence(monWedFri, '2026-03-09')).toBe('2026-03-11')
      expect(nextOccurrence(monWedFri, '2026-03-11')).toBe('2026-03-13')
      expect(nextOccurrence(monWedFri, '2026-03-13')).toBe('2026-03-16')
    })

    it('finds the next matching day from a day that is not in the set', () => {
      expect(nextOccurrence(monWedFri, '2026-03-10')).toBe('2026-03-11') // 화 → 수
      expect(nextOccurrence(monWedFri, '2026-03-14')).toBe('2026-03-16') // 토 → 월
      expect(nextOccurrence(monWedFri, '2026-03-15')).toBe('2026-03-16') // 일 → 월
    })

    it('treats Monday as the start of the week (Sunday is the last day)', () => {
      expect(nextOccurrence(weekly(1, [0]), '2026-03-09')).toBe('2026-03-15') // 월 → 같은 주 일요일
      expect(nextOccurrence(weekly(1, [0]), '2026-03-15')).toBe('2026-03-22')
      expect(nextOccurrence(weekly(1, [0, 1]), '2026-03-15')).toBe('2026-03-16')
    })

    it('every other week', () => {
      expect(nextOccurrence(weekly(2, [1]), '2026-03-09')).toBe('2026-03-23')
      expect(nextOccurrence(weekly(2, [1, 3]), '2026-03-09')).toBe('2026-03-11')
      expect(nextOccurrence(weekly(2, [1, 3]), '2026-03-11')).toBe('2026-03-23')
    })

    it('uses the same weekday when byWeekday is missing', () => {
      expect(nextOccurrence(weekly(1), '2026-03-10')).toBe('2026-03-17')
      expect(nextOccurrence(weekly(2), '2026-03-10')).toBe('2026-03-24')
    })

    it('crosses the end of the year', () => {
      expect(nextOccurrence(weekly(1, [5]), '2026-12-25')).toBe('2027-01-01')
    })
  })

  describe('monthly', () => {
    it('day 31 falls back to the last day of shorter months', () => {
      const rule = monthly(1, 31)

      expect(nextOccurrence(rule, '2026-01-31')).toBe('2026-02-28')
      expect(nextOccurrence(rule, '2026-02-28')).toBe('2026-03-31')
      expect(nextOccurrence(rule, '2026-03-31')).toBe('2026-04-30')
      expect(nextOccurrence(rule, '2026-04-30')).toBe('2026-05-31')
    })

    it('uses Feb 29 in a leap year', () => {
      expect(nextOccurrence(monthly(1, 31), '2028-01-31')).toBe('2028-02-29')
      expect(nextOccurrence(monthly(1, 30), '2028-01-30')).toBe('2028-02-29')
    })

    it('a day later in the same month still counts', () => {
      expect(nextOccurrence(monthly(1, 15), '2026-01-10')).toBe('2026-01-15')
      expect(nextOccurrence(monthly(1, 15), '2026-01-15')).toBe('2026-02-15')
    })

    it('every other month and across the year end', () => {
      expect(nextOccurrence(monthly(2, 15), '2026-01-15')).toBe('2026-03-15')
      expect(nextOccurrence(monthly(1, 15), '2026-12-15')).toBe('2027-01-15')
      expect(nextOccurrence(monthly(3, 15), '2026-11-15')).toBe('2027-02-15')
    })

    it('keeps the day of the month when byMonthDay is missing', () => {
      expect(nextOccurrence(monthly(1), '2026-01-20')).toBe('2026-02-20')
    })
  })

  describe('yearly', () => {
    it('same month and day next year', () => {
      expect(nextOccurrence(yearly(), '2023-03-05')).toBe('2024-03-05')
      expect(nextOccurrence(yearly(2), '2024-03-05')).toBe('2026-03-05')
      expect(nextOccurrence(yearly(), '2026-12-31')).toBe('2027-12-31')
    })

    it('Feb 29 becomes Feb 28 in a common year, and stays Feb 29 across leap years', () => {
      expect(nextOccurrence(yearly(), '2024-02-29')).toBe('2025-02-28')
      expect(nextOccurrence(yearly(4), '2024-02-29')).toBe('2028-02-29')
    })
  })

  it('rejects an invalid rule', () => {
    expect(() => nextOccurrence({ freq: 'daily', interval: 0 }, '2026-03-10')).toThrow(RangeError)
    expect(() => nextOccurrence({ freq: 'weekly', interval: 1, byWeekday: [] }, '2026-03-10')).toThrow(RangeError)
  })
})

describe('firstOccurrence', () => {
  it('weekly: first matching weekday on or after the date', () => {
    const rule = weekly(1, [1, 3, 5])

    expect(firstOccurrence(rule, '2026-11-22')).toBe('2026-11-23') // 일 → 월
    expect(firstOccurrence(rule, '2026-11-23')).toBe('2026-11-23') // 월(포함)
    expect(firstOccurrence(rule, '2026-11-24')).toBe('2026-11-25') // 화 → 수
  })

  it('weekly without weekdays: the date itself', () => {
    expect(firstOccurrence(weekly(1), '2026-11-22')).toBe('2026-11-22')
  })

  it('monthly: this month if the day has not passed, else next month', () => {
    expect(firstOccurrence(monthly(1, 15), '2026-11-22')).toBe('2026-12-15')
    expect(firstOccurrence(monthly(1, 15), '2026-11-15')).toBe('2026-11-15')
    expect(firstOccurrence(monthly(1, 15), '2026-11-10')).toBe('2026-11-15')
    expect(firstOccurrence(monthly(1, 31), '2026-02-10')).toBe('2026-02-28')
    expect(firstOccurrence(monthly(1, 31), '2026-03-01')).toBe('2026-03-31')
    expect(firstOccurrence(monthly(1, 15), '2026-12-20')).toBe('2027-01-15')
  })

  it('daily, yearly and monthly without a day: the date itself', () => {
    expect(firstOccurrence(daily(), '2026-11-22')).toBe('2026-11-22')
    expect(firstOccurrence(yearly(), '2026-11-22')).toBe('2026-11-22')
    expect(firstOccurrence(monthly(1), '2026-11-22')).toBe('2026-11-22')
  })
})

describe('nextOccurrenceFrom', () => {
  it('skips occurrences before the lower bound', () => {
    // 2026-01-05 는 월요일. 월요일: 03-02, 03-09, 03-16
    expect(nextOccurrenceFrom(weekly(1, [1]), '2026-01-05', '2026-03-10')).toBe('2026-03-16')
  })

  it('includes the lower bound itself', () => {
    expect(nextOccurrenceFrom(weekly(1, [1]), '2026-01-05', '2026-03-09')).toBe('2026-03-09')
  })

  it('is always after the previous date, even when the bound is earlier', () => {
    expect(nextOccurrenceFrom(weekly(1, [1]), '2026-03-09', '2026-03-01')).toBe('2026-03-16')
  })

  it('keeps the phase of an every-other-week rule', () => {
    // 01-05, 01-19, 02-02, ... 03-02, 03-16
    expect(nextOccurrenceFrom(weekly(2, [1]), '2026-01-05', '2026-03-10')).toBe('2026-03-16')
    expect(nextOccurrenceFrom(weekly(2, [1]), '2026-01-05', '2026-03-03')).toBe('2026-03-16')
  })

  it('handles a daily task that is years overdue', () => {
    expect(nextOccurrenceFrom(daily(), '2020-01-01', '2026-03-10')).toBe('2026-03-10')
  })

  it('monthly day 31 over many months', () => {
    expect(nextOccurrenceFrom(monthly(1, 31), '2026-01-31', '2026-06-01')).toBe('2026-06-30')
  })
})

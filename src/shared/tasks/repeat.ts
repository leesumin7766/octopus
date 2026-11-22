import type { RepeatRule } from './types'
import { repeatRuleProblem } from '../validation/task'
import { addDays, daysInMonth, formatDate, mondayIndex, parseDate, weekdayOf } from './dates'

// 반복 규칙 계산. 모두 YYYY-MM-DD 문자열 기준의 순수 함수다.

function assertRule(rule: RepeatRule): void {
  const problem = repeatRuleProblem(rule)
  if (problem) throw new RangeError(`invalid repeat rule: ${problem}`)
}

function clampedDate(year: number, month: number, day: number): string {
  return formatDate(year, month, Math.min(day, daysInMonth(year, month)))
}

function addMonths(year: number, month: number, months: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + months
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/**
 * afterDate 보다 뒤의 첫 회차. afterDate 가 속한 주기(주·달·해)에 남은 회차가 있으면 그것,
 * 없으면 interval 만큼 뒤의 주기를 쓴다. 그래서 격주·격월은 afterDate 를 기준으로 이어진다.
 *
 * - weekly: byWeekday 가 없으면 afterDate 와 같은 요일. 주의 시작은 월요일.
 * - monthly: 그 달에 없는 날(31일 등)은 그 달의 마지막 날.
 * - yearly: afterDate 와 같은 월·일, 평년의 2/29 는 2/28.
 *   (규칙에 월·일이 없어서 한 번 2/28 로 밀리면 2/29 로 돌아오지 못한다.)
 */
export function nextOccurrence(rule: RepeatRule, afterDate: string): string {
  assertRule(rule)

  switch (rule.freq) {
    case 'daily':
      return addDays(afterDate, rule.interval)

    case 'weekly': {
      const current = mondayIndex(weekdayOf(afterDate))
      const days = rule.byWeekday?.length ? rule.byWeekday.map(mondayIndex) : [current]
      const sorted = [...new Set(days)].sort((a, b) => a - b)
      const weekStart = addDays(afterDate, -current)

      const later = sorted.find((day) => day > current)
      return later !== undefined
        ? addDays(weekStart, later)
        : addDays(weekStart, 7 * rule.interval + sorted[0])
    }

    case 'monthly': {
      const { year, month, day } = parseDate(afterDate)
      const target = rule.byMonthDay ?? day

      const sameMonth = clampedDate(year, month, target)
      if (sameMonth > afterDate) return sameMonth

      const next = addMonths(year, month, rule.interval)
      return clampedDate(next.year, next.month, target)
    }

    case 'yearly': {
      const { year, month, day } = parseDate(afterDate)
      return clampedDate(year + rule.interval, month, day)
    }
  }
}

/**
 * onOrAfter 이상의 첫 해당일. 반복이 막 시작될 때 첫 날짜를 정하는 데 쓴다(interval 은 보지 않음).
 * 규칙이 요일·날짜를 정하지 않았으면 onOrAfter 자체가 첫 날짜다.
 */
export function firstOccurrence(rule: RepeatRule, onOrAfter: string): string {
  assertRule(rule)

  switch (rule.freq) {
    case 'weekly': {
      const weekdays = rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(onOrAfter)]
      for (let offset = 0; offset < 7; offset++) {
        const date = addDays(onOrAfter, offset)
        if (weekdays.includes(weekdayOf(date))) return date
      }
      return onOrAfter
    }

    case 'monthly': {
      const { year, month, day } = parseDate(onOrAfter)
      const target = rule.byMonthDay ?? day

      const sameMonth = clampedDate(year, month, target)
      if (sameMonth >= onOrAfter) return sameMonth

      const next = addMonths(year, month, 1)
      return clampedDate(next.year, next.month, target)
    }

    case 'daily':
    case 'yearly':
      return onOrAfter
  }
}

const MAX_STEPS = 200_000

/**
 * previousDate 보다 뒤이면서 notBefore 이상인 첫 회차.
 * 오래 밀린 반복 할 일을 끝냈을 때 "오늘 이후의 다음 회차"를 구한다.
 */
export function nextOccurrenceFrom(rule: RepeatRule, previousDate: string, notBefore: string): string {
  let date = nextOccurrence(rule, previousDate)
  for (let steps = 0; date < notBefore; steps++) {
    if (steps >= MAX_STEPS) throw new RangeError('repeat rule produced too many occurrences to reach the target date')
    date = nextOccurrence(rule, date)
  }
  return date
}

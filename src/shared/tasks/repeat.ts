import type { RepeatRule } from './types'
import { repeatRuleProblem } from '../validation/task'
import { addDays, daysInMonth, diffDays, formatDate, mondayIndex, parseDate, weekdayOf } from './dates'

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

/** 기준일(anchor) 이 있고 간격이 1 보다 크면, 주기를 직전 회차가 아니라 기준일에서부터 센다. 그 밖에는 예전 동작 그대로다. */
function isAnchored(rule: RepeatRule): rule is RepeatRule & { anchor: string } {
  return rule.anchor !== undefined && rule.interval > 1
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

const MAX_CYCLES = 1000

/** 매일: 기준일 + k×interval 중 afterDate 보다 뒤의 첫 날 */
function nextAnchoredDaily(rule: RepeatRule & { anchor: string }, afterDate: string): string {
  if (afterDate < rule.anchor) return rule.anchor
  const k = Math.floor(diffDays(afterDate, rule.anchor) / rule.interval) + 1
  return addDays(rule.anchor, k * rule.interval)
}

/** 매주: 기준일이 있는 주(월요일 시작)를 0번째로 세어 interval 주마다 오는 주의 요일들 중 afterDate 뒤의 첫 날(기준일 이전은 건너뜀) */
function nextAnchoredWeekly(rule: RepeatRule & { anchor: string }, afterDate: string): string {
  const anchorIndex = mondayIndex(weekdayOf(rule.anchor))
  const days = rule.byWeekday?.length ? [...new Set(rule.byWeekday.map(mondayIndex))].sort((a, b) => a - b) : [anchorIndex]
  const anchorWeek = addDays(rule.anchor, -anchorIndex)
  const afterWeek = diffDays(addDays(afterDate, -mondayIndex(weekdayOf(afterDate))), anchorWeek) / 7
  const start = Math.max(afterWeek, 0)
  for (let week = start; week <= start + rule.interval; week++) {
    if (week % rule.interval !== 0) continue
    for (const day of days) {
      const date = addDays(anchorWeek, week * 7 + day)
      if (date > afterDate && date >= rule.anchor) return date
    }
  }
  throw new RangeError('repeat rule produced no occurrence')
}

/** 매월: 기준일의 달을 0번째로 세어 interval 개월마다. 날은 byMonthDay, 없으면 기준일의 일(짧은 달은 마지막 날) */
function nextAnchoredMonthly(rule: RepeatRule & { anchor: string }, afterDate: string): string {
  const anchor = parseDate(rule.anchor)
  const after = parseDate(afterDate)
  const target = rule.byMonthDay ?? anchor.day
  const anchorIndex = monthIndex(anchor.year, anchor.month)
  const start = Math.max(monthIndex(after.year, after.month), anchorIndex)
  for (let index = start; index <= start + rule.interval + 1; index++) {
    if ((index - anchorIndex) % rule.interval !== 0) continue
    const date = clampedDate(Math.floor(index / 12), (index % 12) + 1, target)
    if (date > afterDate && date >= rule.anchor) return date
  }
  throw new RangeError('repeat rule produced no occurrence')
}

/** 매년 월·일: 같은 해의 그 날이 afterDate 뒤면 그것, 아니면 interval 년 뒤. 기준일이 있으면 기준일의 해부터 interval 년마다. */
function nextYearlyMonthDay(rule: RepeatRule & { byMonth: number; byMonthDay: number }, afterDate: string): string {
  const after = parseDate(afterDate)
  const dateIn = (year: number): string => clampedDate(year, rule.byMonth, rule.byMonthDay)

  if (rule.anchor === undefined) {
    const sameYear = dateIn(after.year)
    return sameYear > afterDate ? sameYear : dateIn(after.year + rule.interval)
  }
  const anchorYear = parseDate(rule.anchor).year
  let year = after.year > anchorYear ? anchorYear + Math.floor((after.year - anchorYear) / rule.interval) * rule.interval : anchorYear
  for (let cycles = 0; cycles < MAX_CYCLES; cycles++, year += rule.interval) {
    const date = dateIn(year)
    if (date > afterDate && date >= rule.anchor) return date
  }
  throw new RangeError('repeat rule produced no occurrence')
}

/**
 * afterDate 보다 뒤의 첫 회차. afterDate 가 속한 주기(주·달·해)에 남은 회차가 있으면 그것,
 * 없으면 interval 만큼 뒤의 주기를 쓴다. 그래서 격주·격월은 afterDate 를 기준으로 이어진다.
 * 규칙에 기준일(anchor)이 있고 interval 이 1 보다 크면 대신 기준일에서부터 주기를 센다(날짜를 옮겨도 주기가 어긋나지 않는다).
 *
 * - weekly: byWeekday 가 없으면 afterDate 와 같은 요일. 주의 시작은 월요일.
 * - monthly: 그 달에 없는 날(31일 등)은 그 달의 마지막 날.
 * - yearly: byMonth·byMonthDay 가 있으면 매년 그 월·일(평년의 2/29 는 2/28, 윤년에는 다시 2/29).
 *   없으면 afterDate 와 같은 월·일, 평년의 2/29 는 2/28.
 *   (월·일이 없는 옛 규칙은 한 번 2/28 로 밀리면 2/29 로 돌아오지 못한다.)
 */
export function nextOccurrence(rule: RepeatRule, afterDate: string): string {
  assertRule(rule)

  switch (rule.freq) {
    case 'daily':
      return isAnchored(rule) ? nextAnchoredDaily(rule, afterDate) : addDays(afterDate, rule.interval)

    case 'weekly': {
      if (isAnchored(rule)) return nextAnchoredWeekly(rule, afterDate)
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
      if (isAnchored(rule)) return nextAnchoredMonthly(rule, afterDate)
      const { year, month, day } = parseDate(afterDate)
      const target = rule.byMonthDay ?? day

      const sameMonth = clampedDate(year, month, target)
      if (sameMonth > afterDate) return sameMonth

      const next = addMonths(year, month, rule.interval)
      return clampedDate(next.year, next.month, target)
    }

    case 'yearly': {
      if (rule.byMonth !== undefined && rule.byMonthDay !== undefined) {
        return nextYearlyMonthDay({ ...rule, byMonth: rule.byMonth, byMonthDay: rule.byMonthDay }, afterDate)
      }
      const { year, month, day } = parseDate(afterDate)
      return clampedDate(year + rule.interval, month, day)
    }
  }
}

/**
 * 새 반복의 기준일을 채운다: anchor = 그 할 일의 날짜, 매년이면 byMonth·byMonthDay 도 그 날짜의 월·일로
 * (이미 있는 값은 그대로). 빠른 입력 파서와 반복 편집기가 새 반복을 만들 때 쓴다.
 */
export function withAnchor(rule: RepeatRule, date: string): RepeatRule {
  const { month, day } = parseDate(date)
  const anchored: RepeatRule = { ...rule, anchor: date }
  if (rule.freq === 'yearly') {
    anchored.byMonth = rule.byMonth ?? month
    anchored.byMonthDay = rule.byMonthDay ?? day
  }
  return anchored
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

    case 'yearly': {
      if (rule.byMonth === undefined || rule.byMonthDay === undefined) return onOrAfter
      const { year } = parseDate(onOrAfter)
      const thisYear = clampedDate(year, rule.byMonth, rule.byMonthDay)
      return thisYear >= onOrAfter ? thisYear : clampedDate(year + 1, rule.byMonth, rule.byMonthDay)
    }

    case 'daily':
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

/**
 * afterDate 뒤의 회차 중 from..to(양 끝 포함)에 드는 날짜들. 저장하지 않고 보기만 하는 데 쓴다(달력의 '예정(반복)').
 * afterDate 가 from 보다 한참 앞이어도(오래 밀린 반복) 첫 회차를 from 근처로 바로 건너뛴 뒤(nextOccurrenceFrom) to 까지 걷는다.
 * limit 은 from..to 안에서 걷는 걸음 수 상한이다. 건너뛰다 너무 많은 회차를 만나면(규칙이 비정상) 빈 목록을 돌려준다.
 */
export function futureOccurrences(rule: RepeatRule, afterDate: string, from: string, to: string, limit = 200): string[] {
  let current: string
  try {
    current = nextOccurrenceFrom(rule, afterDate, from)
  } catch (error) {
    if (error instanceof RangeError) return []
    throw error
  }
  const dates: string[] = []
  for (let step = 0; step < limit && current <= to; step++) {
    dates.push(current)
    current = nextOccurrence(rule, current)
  }
  return dates
}

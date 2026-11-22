import { diffDays, localDateString, parseDate, weekdayOf } from '../../shared/tasks/dates'
import type { RepeatRule } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'

const t = ko.tasks

export function todayString(now: Date = new Date()): string {
  return localDateString(now)
}

/** 오늘·내일·어제는 말로, 나머지는 "3/11 (수)" (다른 해면 연도 포함). */
export function formatDate(date: string, today: string): string {
  const offset = diffDays(date, today)
  if (offset === 0) return t.relativeDay.today
  if (offset === 1) return t.relativeDay.tomorrow
  if (offset === -1) return t.relativeDay.yesterday

  const { year, month, day } = parseDate(date)
  const weekday = t.weekdays[weekdayOf(date)]
  const base = `${month}/${day} (${weekday})`
  return year === parseDate(today).year ? base : `${year}/${base}`
}

export function formatRepeat(rule: RepeatRule): string {
  const r = t.repeat
  const every = rule.interval

  switch (rule.freq) {
    case 'daily':
      return every === 1 ? r.daily : r.everyDays(every)

    case 'weekly': {
      const days = [...new Set(rule.byWeekday ?? [])].sort((a, b) => a - b)
      if (days.length === 5 && days.join() === '1,2,3,4,5' && every === 1) return r.weekdays
      const names = days.map((d) => t.weekdays[d]).join(' ')
      const head = every === 1 ? r.weekly : r.everyWeeks(every)
      return names ? `${head} ${names}` : head
    }

    case 'monthly':
      if (every !== 1) return r.everyMonths(every)
      return rule.byMonthDay ? r.monthlyDay(rule.byMonthDay) : r.monthly

    case 'yearly':
      return every === 1 ? r.yearly : r.everyYears(every)
  }
}

/** 마감일이 오늘보다 앞이면 지난 것. */
export function isPastDate(date: string, today: string): boolean {
  return date < today
}

/** 다음 자정까지 남은 밀리초(로컬 시각 기준). */
export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return next.getTime() - now.getTime()
}

/** "a, b, ,a" → ["a", "b"] */
export function splitTags(text: string): string[] {
  return [...new Set(text.split(',').map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}

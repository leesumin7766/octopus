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

/** 홈 제목: "11월 22일 일요일" */
export function formatHomeDate(date: Date): string {
  return ko.home.dateHeading(date.getMonth() + 1, date.getDate(), ko.tasks.weekdays[date.getDay()])
}

/** 루틴 요일 요약: 매일 / 평일 / 주말 / "월 수 금" */
export function formatDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  const key = sorted.join()
  if (sorted.length === 7) return ko.routines.everyDay
  if (key === '1,2,3,4,5') return ko.routines.weekdays
  if (key === '0,6') return ko.routines.weekend
  return sorted.map((d) => ko.routines.weekdayNames[d]).join(' ')
}

/** ISO 시각을 로컬 "오늘 14:05" · "11/27 (목) 09:30" 로(날짜는 formatDate 와 같은 규칙) */
export function formatTimestamp(iso: string, today: string = todayString()): string {
  const d = new Date(iso)
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(localDateString(d), today)} ${hours}:${minutes}`
}

/** "a, b, ,a" → ["a", "b"] */
export function splitTags(text: string): string[] {
  return [...new Set(text.split(',').map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}

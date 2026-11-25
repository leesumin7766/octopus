// 달력 제목 글. 날짜 상세 제목에는 요일을 붙이고, 오늘이면 "· 오늘"을 덧붙인다.
import { parseDate, weekdayOf } from '../../../shared/tasks/dates'
import type { MonthRef } from '../../../shared/calendar/month'
import { ko } from '../../i18n/ko'

/** 예: 2026년 11월 25일 (수) · 오늘 */
export function formatDayTitle(date: string, today: string): string {
  const { year, month, day } = parseDate(date)
  const base = `${year}년 ${month}월 ${day}일 (${ko.tasks.weekdays[weekdayOf(date)]})`
  return date === today ? `${base} · ${ko.home.localCalendar.todayMark}` : base
}

/** 예: 2026년 11월 */
export function formatMonthTitle(ref: MonthRef): string {
  return `${ref.year}년 ${ref.month}월`
}

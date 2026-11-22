// YYYY-MM-DD 문자열 기준의 순수 달력 계산. 시간대의 영향을 받지 않도록 UTC 로만 계산한다.

export interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

const MS_PER_DAY = 86_400_000

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

export function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/** 올바른 YYYY-MM-DD 라고 가정하고 쪼갠다. */
export function parseDate(date: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new RangeError(`not a YYYY-MM-DD date: ${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function toUtc(date: string): number {
  const { year, month, day } = parseDate(date)
  return Date.UTC(year, month - 1, day)
}

function fromUtc(ms: number): string {
  const d = new Date(ms)
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * MS_PER_DAY)
}

/** 0=일 .. 6=토 */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay()
}

/** 월요일 시작 주에서의 위치. 0=월 .. 6=일 */
export function mondayIndex(weekday: number): number {
  return (weekday + 6) % 7
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Date 의 "로컬" 달력 날짜. 사용자가 보는 오늘을 구할 때 쓴다. */
export function localDateString(date: Date): string {
  return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

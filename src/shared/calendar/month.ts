// 월간 달력의 격자 계산. 순수 함수만 있다. 날짜는 모두 YYYY-MM-DD 문자열이고, 격자는 일요일 시작 6주(42칸)다.
import { addDays, formatDate, parseDate, weekdayOf } from '../tasks/dates'

export interface MonthRef {
  year: number
  /** 1-12 */
  month: number
}

/** 월 격자의 칸 수: 어느 달이든 6주를 채운다. */
export const GRID_DAYS = 42

function assertMonth(ref: MonthRef): void {
  if (!Number.isInteger(ref.year) || ref.year < 1 || ref.year > 9999) throw new RangeError(`bad year: ${ref.year}`)
  if (!Number.isInteger(ref.month) || ref.month < 1 || ref.month > 12) throw new RangeError(`bad month: ${ref.month}`)
}

/** YYYY-MM-DD 가 속한 달 */
export function monthOf(date: string): MonthRef {
  const { year, month } = parseDate(date)
  return { year, month }
}

/** 달을 delta 만큼 옮긴다(음수 가능). 12월 다음은 다음 해 1월. */
export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  assertMonth(ref)
  const index = ref.year * 12 + (ref.month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** 격자의 42칸. 첫 칸은 1일이 속한 주의 일요일(앞 달 날짜일 수 있다). */
export function monthGridDates(ref: MonthRef): string[] {
  assertMonth(ref)
  const first = formatDate(ref.year, ref.month, 1)
  const start = addDays(first, -weekdayOf(first))
  return Array.from({ length: GRID_DAYS }, (_, index) => addDays(start, index))
}

/** 격자 전체가 걸치는 구간(양 끝 포함). 날짜 구간 조회에 그대로 쓴다. */
export function gridRange(ref: MonthRef): { from: string; to: string } {
  const cells = monthGridDates(ref)
  return { from: cells[0], to: cells[cells.length - 1] }
}

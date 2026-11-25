import { useMemo, useState, type ReactNode } from 'react'
import { countByDate } from '../../../shared/calendar/day'
import { gridRange, monthGridDates, monthOf, shiftMonth, type MonthRef } from '../../../shared/calendar/month'
import type { CalendarToday } from '../../../shared/calendar/types'
import { ko } from '../../i18n/ko'
import { formatDayTitle, formatMonthTitle } from '../calendar/format'
import { useTasksInRange } from '../calendar/useTasksInRange'

const c = ko.home.calendar
const m = ko.home.localCalendar

interface CalendarCardProps {
  /** Google 상태(아직 읽기 전이면 null). 달력 자체는 이것과 상관없이 보인다. */
  calendar: CalendarToday | null
  /** 바뀌면 할 일 수를 다시 읽는다(추가·완료 등 데이터가 바뀐 뒤) */
  refreshKey: number
  /** 오늘(로컬 날짜, YYYY-MM-DD) */
  today: string
  /** 마지막으로 고른 날짜(상세를 닫아도 남는다). 칸에 선택 표시를 한다. */
  selectedDay: string | null
  /** 날짜 칸을 누르면: 날짜 상세를 연다 */
  onOpenDay: (date: string) => void
  onOpenArms: () => void
  onReconnect: () => void
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 캘린더 카드: 월간 달력(로컬 할 일의 날짜별 보기)과 아래 한 줄의 Google 상태.
 * Google 이 없거나 실패해도 달력은 그대로 보이고 쓸 수 있다.
 */
export function CalendarCard({ calendar, refreshKey, today, selectedDay, onOpenDay, onOpenArms, onReconnect }: CalendarCardProps) {
  const [shown, setShown] = useState<MonthRef>(() => monthOf(today))
  const cells = useMemo(() => monthGridDates(shown), [shown])
  const range = gridRange(shown)
  // 갱신 신호나 오늘 날짜가 바뀌면 같은 달의 개수를 다시 읽는다(자정 경과 포함).
  const { state, retry } = useTasksInRange(range.from, range.to, `${refreshKey}|${today}`)
  const counts = useMemo(() => (state.status === 'ready' ? countByDate(state.tasks) : null), [state])
  const monthKey = `${shown.year}-${pad2(shown.month)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={m.prevMonth}
          onClick={() => setShown((s) => shiftMonth(s, -1))}
          className="size-6 rounded-md border border-line bg-white text-sm hover:bg-black/5"
        >
          ‹
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-sm font-semibold">{formatMonthTitle(shown)}</p>
          <button
            type="button"
            onClick={() => setShown(monthOf(today))}
            className="min-h-7 rounded-md border border-line bg-white px-2 text-xs hover:bg-black/5"
          >
            {m.today}
          </button>
        </div>
        <button
          type="button"
          aria-label={m.nextMonth}
          onClick={() => setShown((s) => shiftMonth(s, 1))}
          className="size-6 rounded-md border border-line bg-white text-sm hover:bg-black/5"
        >
          ›
        </button>
      </div>

      {state.status === 'error' && (
        <div className="flex items-center gap-2 text-xs text-[#7d2a21]">
          <span>{m.countsFailed}</span>
          <button type="button" onClick={retry} className="min-h-7 rounded-md border border-line bg-white px-2 text-ink hover:bg-black/5">
            {m.retry}
          </button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
        {ko.tasks.weekdays.map((weekday) => (
          <span key={weekday} className="leading-4 text-[#5e5d58]">
            {weekday}
          </span>
        ))}
        {cells.map((date) => {
          const inMonth = date.startsWith(monthKey)
          const isToday = date === today
          const isSelected = date === selectedDay
          const count = counts?.get(date)
          const base = count ? `${formatDayTitle(date, today)}, ${m.dayCount(count.total, count.done)}` : formatDayTitle(date, today)
          const label = isSelected ? `${base}, ${m.selectedMark}` : base
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected ? true : undefined}
              aria-label={label}
              onClick={() => onOpenDay(date)}
              className={`relative flex h-6 items-center justify-center rounded-md border text-xs hover:bg-black/5 ${
                isSelected ? 'bg-accent-soft ring-2 ring-accent' : ''
              } ${isToday ? 'border-accent font-bold text-accent-strong' : 'border-transparent'} ${inMonth ? 'text-ink' : 'text-[#a8a7a1]'}`}
            >
              <span>{Number(date.slice(8))}</span>
              {count && (
                <span aria-hidden="true" className="absolute right-0.5 top-0 text-[9px] leading-none text-accent-strong">
                  {count.total}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-auto border-t border-line pt-1.5 text-[11px]">{googleLine(calendar, onOpenArms, onReconnect)}</div>
    </div>
  )
}

/** 카드 아래 한 줄: Google 상태만 알린다. 달력을 가리지 않는다. */
function googleLine(calendar: CalendarToday | null, onOpenArms: () => void, onReconnect: () => void): ReactNode {
  if (calendar === null) return null
  if (!calendar.configured) return <p className="text-[#5e5d58]">{calendar.unavailableReason ?? c.notConfigured}</p>

  switch (calendar.status.state) {
    case 'error':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-[#7d2a21]">
            {calendar.status.reason}
          </p>
          <button type="button" onClick={onReconnect} className="min-h-7 rounded-md bg-accent px-2 font-semibold text-white hover:bg-accent-strong">
            {c.reconnect}
          </button>
        </div>
      )
    case 'connecting':
      return <p className="text-[#5e5d58]">{c.connecting}</p>
    case 'off':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[#5e5d58]">{c.empty}</p>
          <button type="button" onClick={onOpenArms} className="min-h-7 rounded-md border border-line bg-white px-2 hover:bg-black/5">
            {c.connect}
          </button>
        </div>
      )
    case 'on':
      return <p className="text-[#5e5d58]">{m.googleTodayCount(calendar.events.length)}</p>
  }
}

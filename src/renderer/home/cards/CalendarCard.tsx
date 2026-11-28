import { useMemo, useState, type ReactNode } from 'react'
import { countByDate } from '../../../shared/calendar/day'
import { gridRange, monthGridDates, monthOf, shiftMonth, type MonthRef } from '../../../shared/calendar/month'
import type { CalendarToday } from '../../../shared/calendar/types'
import { ko } from '../../i18n/ko'
import { formatDayTitle, formatMonthTitle } from '../calendar/format'
import { useGhosts } from '../calendar/useGhosts'
import { useTasksInRange } from '../calendar/useTasksInRange'
import { countGhosts } from '../../../shared/calendar/ghosts'
import { Icon } from '../../ui/Icon'

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
  onReconnect: () => void
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 캘린더 카드: 월간 달력(로컬 할 일의 날짜별 보기)과 아래 한 줄의 Google 상태.
 * Google 이 없거나 실패해도 달력은 그대로 보이고 쓸 수 있다.
 */
export function CalendarCard({ calendar, refreshKey, today, selectedDay, onOpenDay, onReconnect }: CalendarCardProps) {
  const [shown, setShown] = useState<MonthRef>(() => monthOf(today))
  const cells = useMemo(() => monthGridDates(shown), [shown])
  const range = gridRange(shown)
  // 갱신 신호나 오늘 날짜가 바뀌면 같은 달의 개수를 다시 읽는다(자정 경과 포함).
  const { state, retry } = useTasksInRange(range.from, range.to, `${refreshKey}|${today}`)
  const counts = useMemo(() => (state.status === 'ready' ? countByDate(state.tasks) : null), [state])
  // 앞으로의 반복 회차(저장하지 않고 계산만 한 것)는 흐린 점으로만 보인다.
  const ghosts = useGhosts(range.from, range.to, `${refreshKey}|${today}`, state.status === 'ready' ? state.tasks : null)
  const ghostCounts = useMemo(() => countGhosts(ghosts), [ghosts])
  const monthKey = `${shown.year}-${pad2(shown.month)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={m.prevMonth}
          onClick={() => setShown((s) => shiftMonth(s, -1))}
          className="flex size-6 items-center justify-center rounded-md text-[#5e5d58] hover:bg-black/5"
        >
          <Icon name="prev" size={16} />
        </button>
        <p className="text-sm font-semibold">{formatMonthTitle(shown)}</p>
        <button
          type="button"
          aria-label={m.nextMonth}
          onClick={() => setShown((s) => shiftMonth(s, 1))}
          className="flex size-6 items-center justify-center rounded-md text-[#5e5d58] hover:bg-black/5"
        >
          <Icon name="next" size={16} />
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
          const ghostCount = ghostCounts.get(date) ?? 0
          const real = count ? `${formatDayTitle(date, today)}, ${m.dayCount(count.total, count.done)}` : formatDayTitle(date, today)
          const base = ghostCount > 0 ? `${real}, ${m.ghostCount(ghostCount)}` : real
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
              {ghostCount > 0 && <span aria-hidden="true" className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent/30" />}
              {count && (
                <span aria-hidden="true" className="absolute right-0.5 top-0 text-[9px] leading-none text-accent-strong">
                  {count.total}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {googleLine(calendar, onReconnect)}
    </div>
  )
}

/**
 * 카드 아래 한 줄: Google 이 연결돼 있거나 연결이 끊겼을 때만 보인다.
 * 연결하지 않았거나 준비 중이면 아무것도 쓰지 않는다(연결은 Arms 화면에서). 달력을 가리지 않는다.
 */
function googleLine(calendar: CalendarToday | null, onReconnect: () => void): ReactNode {
  if (calendar === null || !calendar.configured) return null
  const line = (children: ReactNode): ReactNode => <div className="mt-auto border-t border-line pt-1.5 text-[11px]">{children}</div>
  switch (calendar.status.state) {
    case 'error':
      return line(
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-[#7d2a21]">
            {calendar.status.reason}
          </p>
          <button type="button" onClick={onReconnect} className="min-h-7 rounded-md bg-accent px-2 font-semibold text-white hover:bg-accent-strong">
            {c.reconnect}
          </button>
        </div>
      )
    case 'on':
      return line(<p className="text-[#5e5d58]">{m.googleTodayCount(calendar.events.length)}</p>)
    default:
      return null
  }
}

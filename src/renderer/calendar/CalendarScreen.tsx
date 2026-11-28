import { useEffect, useMemo, useRef, useState } from 'react'
import { countByDate, type DayCount } from '../../shared/calendar/day'
import { gridRange, monthGridDates, monthOf, shiftMonth, type MonthRef } from '../../shared/calendar/month'
import { useDataChanged } from '../dataEvents'
import { DayDialog, type DayViewHandle } from '../home/calendar/DayDialog'
import { formatDayTitle, formatMonthTitle } from '../home/calendar/format'
import { useGhosts } from '../home/calendar/useGhosts'
import { useGoogleToday } from '../home/calendar/useGoogleToday'
import { countGhosts } from '../../shared/calendar/ghosts'
import { useTasksInRange } from '../home/calendar/useTasksInRange'
import { ko } from '../i18n/ko'
import { safeInvoke } from '../safeInvoke'
import { msUntilNextMidnight, todayString } from '../tasks/format'
import { Icon } from '../ui/Icon'

const t = ko.calendarScreen
const m = ko.home.localCalendar

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 할 일 상태 표시(ATDT 와 같다): 다 함 ● / 일부 ◐ / 하나도 못 함 ○ */
function mark(count: DayCount): { symbol: string; className: string } {
  if (count.done === count.total) return { symbol: '●', className: 'text-[#2f7d4f]' }
  if (count.done > 0) return { symbol: '◐', className: 'text-[#b7791f]' }
  return { symbol: '○', className: 'text-[#8a8983]' }
}

/**
 * 달력 화면(ATDT 의 달력 탭과 같은 구성): 왼쪽 큰 월간 달력, 오른쪽 고른 날짜의 할 일.
 * 오른쪽은 홈의 날짜 상세와 같은 기능(추가·완료·편집)을 화면에 붙여서 보여 준다.
 */
export function CalendarScreen() {
  const [today, setToday] = useState(todayString)
  const [shown, setShown] = useState<MonthRef>(() => monthOf(todayString()))
  const [selected, setSelected] = useState(todayString)
  const [refreshKey, setRefreshKey] = useState(0)
  /** 원본 열기에 실패했을 때 잠깐 알린다 */
  const [notice, setNotice] = useState<string | null>(null)
  const panel = useRef<DayViewHandle>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useDataChanged(() => setRefreshKey((key) => key + 1))

  // 자정이 지나면 오늘 표시를 옮긴다.
  useEffect(() => {
    const timer = window.setTimeout(() => setToday(todayString()), msUntilNextMidnight(new Date()) + 1000)
    return () => window.clearTimeout(timer)
  }, [today])

  // Google 일정은 홈과 같은 주기로(처음·데이터 변경·1분·창 포커스·자정) 다시 읽는다.
  const { calendar, now, readFailed, loading, reload: loadCalendar } = useGoogleToday(refreshKey)

  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const cells = useMemo(() => monthGridDates(shown), [shown])
  const range = gridRange(shown)
  const { state, retry } = useTasksInRange(range.from, range.to, `${refreshKey}|${today}`)
  const counts = useMemo(() => (state.status === 'ready' ? countByDate(state.tasks) : null), [state])
  const ghosts = useGhosts(range.from, range.to, `${refreshKey}|${today}`, state.status === 'ready' ? state.tasks : null)
  const ghostCounts = useMemo(() => countGhosts(ghosts), [ghosts])
  const monthKey = `${shown.year}-${pad2(shown.month)}`
  const monthTotal = useMemo(() => {
    let total = 0
    let done = 0
    for (const [date, count] of counts ?? []) {
      if (!date.startsWith(monthKey)) continue
      total += count.total
      done += count.done
    }
    return { total, done }
  }, [counts, monthKey])

  /** 칸을 누르면 오른쪽 날짜를 옮긴다(작성 중이면 오른쪽에서 먼저 묻는다). */
  function pick(date: string): void {
    panel.current?.goTo(date)
  }

  /** 오른쪽에서 날짜가 바뀌면 선택 표시를 옮기고, 다른 달이면 그 달을 보여 준다. */
  function onDateChange(date: string): void {
    setSelected(date)
    if (!date.startsWith(monthKey)) setShown(monthOf(date))
  }

  const arrow = 'flex size-8 items-center justify-center rounded-lg text-[#5e5d58] hover:bg-black/5'

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto bg-page p-4 text-ink md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:overflow-hidden">
      <section aria-label={t.title} className="flex min-h-[420px] flex-col rounded-2xl border border-line bg-white p-4">
        <h1 className="sr-only">{t.title}</h1>
        <div className="mb-3 flex items-center gap-1">
          <button type="button" aria-label={m.prevMonth} title={m.prevMonth} onClick={() => setShown((s) => shiftMonth(s, -1))} className={arrow}>
            <Icon name="prev" size={18} />
          </button>
          <p className="min-w-28 text-center text-base font-semibold">{formatMonthTitle(shown)}</p>
          <button type="button" aria-label={m.nextMonth} title={m.nextMonth} onClick={() => setShown((s) => shiftMonth(s, 1))} className={arrow}>
            <Icon name="next" size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              // 달은 패널이 실제로 옮겨질 때(onDateChange) 따라간다. 작성 중이라 묻고 [계속 쓰기]면 달·선택·초안이 그대로다.
              // 이미 오늘을 고르고 있으면 옮길 날짜가 없으니 달만 이번 달로 돌린다.
              if (selected === today) setShown(monthOf(today))
              else pick(today)
            }}
            className="ml-1 min-h-8 rounded-lg px-2.5 text-sm text-[#5e5d58] hover:bg-black/5"
          >
            {m.today}
          </button>
          <span className="flex-1" />
          {monthTotal.total > 0 && <span className="text-xs text-[#5e5d58]">{t.monthDone(monthTotal.done, monthTotal.total)}</span>}
        </div>

        {state.status === 'error' && (
          <div className="mb-2 flex items-center gap-2 text-xs text-[#7d2a21]">
            <span role="alert">{m.countsFailed}</span>
            <button type="button" onClick={retry} className="min-h-7 rounded-md border border-line bg-white px-2 text-ink hover:bg-black/5">
              {m.retry}
            </button>
          </div>
        )}

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-[#5e5d58]">
          {ko.tasks.weekdays.map((weekday, i) => (
            <span key={weekday} className={i === 0 ? 'text-[#b3261e]/70' : i === 6 ? 'text-[#2a5db0]/70' : ''}>
              {weekday}
            </span>
          ))}
        </div>
        <div className="mt-1 grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-1">
          {cells.map((date) => {
            const inMonth = date.startsWith(monthKey)
            const isToday = date === today
            const isSelected = date === selected
            const count = counts?.get(date)
            const dayMark = count ? mark(count) : null
            const ghostCount = ghostCounts.get(date) ?? 0
            const real = count ? `${formatDayTitle(date, today)}, ${m.dayCount(count.total, count.done)}` : formatDayTitle(date, today)
            const label = ghostCount > 0 ? `${real}, ${m.ghostCount(ghostCount)}` : real
            return (
              <button
                key={date}
                type="button"
                data-date={date}
                aria-label={label}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                title={count ? m.dayCount(count.total, count.done) : undefined}
                onClick={() => pick(date)}
                className={`flex min-h-14 flex-col items-start rounded-lg border p-1.5 text-left transition-colors ${
                  isSelected ? 'border-accent bg-accent-soft' : 'border-[#ecebe6] hover:bg-black/[0.03]'
                } ${inMonth ? '' : 'opacity-45'}`}
              >
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                    isToday ? 'bg-accent font-semibold text-white' : 'text-ink'
                  }`}
                >
                  {Number(date.slice(8))}
                </span>
                {ghostCount > 0 && (
                  <span aria-hidden="true" className={`flex items-center gap-1 text-[11px] leading-none text-[#a8a7a1] ${count ? 'mt-0.5' : 'mt-auto'}`}>
                    <span>◌</span>
                    <span>{ghostCount}</span>
                  </span>
                )}
                {count && dayMark && (
                  <span aria-hidden="true" className="mt-auto flex items-center gap-1 text-[11px] leading-none">
                    <span className={dayMark.className}>{dayMark.symbol}</span>
                    <span className="text-[#5e5d58]">{count.total}</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <DayDialog
        variant="panel"
        handleRef={panel}
        startDate={selected}
        onDateChange={onDateChange}
        today={today}
        now={now}
        calendar={calendar}
        refreshKey={refreshKey}
        onClose={() => undefined}
        onReconnect={() => {
          void safeInvoke(() => window.octopus.arms.connect('google-calendar')).then(() => loadCalendar())
        }}
        google={{ loading, readFailed, onRetry: () => void loadCalendar(), showDisconnected: true }}
        onOpenEvent={(id) =>
          void safeInvoke(() => window.octopus.calendar.openEvent(id)).then((result) => {
            if (!result.ok && mounted.current) setNotice(ko.home.calendar.openFailed)
          })
        }
      />
      {notice && (
        <p role="alert" className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[8px] bg-[#1f1f1d] px-3 py-1.5 text-xs text-[#f6f6f3]">
          {notice}
        </p>
      )}
    </div>
  )
}

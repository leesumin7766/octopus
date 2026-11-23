import { useMemo } from 'react'
import type { CalendarEvent, CalendarToday } from '../../../shared/calendar/types'
import { ko } from '../../i18n/ko'

const t = ko.home.calendar

const pad = (n: number): string => String(n).padStart(2, '0')
const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface CalendarCardProps {
  /** 아직 읽어 오기 전이면 null */
  today: CalendarToday | null
  /** 지금 시각(진행 중·지난 일정을 가르는 기준) */
  now: Date
  onOpenArms: () => void
  onReconnect: () => void
  onOpenEvent: (id: string) => void
}

/**
 * 오늘 일정 카드. 연결 안 됨 / 이 빌드에 Google 설정 없음 / 연결됨(시간순 목록) / 오류(이유 + 다시 연결) 네 가지 상태.
 * 일정 제목은 외부 데이터라 글자로만 그린다(HTML 해석 없음).
 */
export function CalendarCard({ today, now, onOpenArms, onReconnect, onOpenEvent }: CalendarCardProps) {
  const events = useMemo(() => today?.events ?? [], [today])

  if (today === null) return <p className="text-sm text-[#5e5d58]">{t.loading}</p>

  if (!today.configured) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-[#5e5d58]">{today.unavailableReason ?? t.notConfigured}</p>
        <p className="text-xs text-[#5e5d58]">{t.notConfiguredHelp}</p>
        <button type="button" onClick={onOpenArms} className="min-h-9 rounded-lg border border-line bg-white px-3 text-sm text-ink hover:bg-black/5">
          {t.openArms}
        </button>
      </div>
    )
  }

  if (today.status.state === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-[#7d2a21]">
          {today.status.reason}
        </p>
        <button type="button" onClick={onReconnect} className="min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong">
          {t.reconnect}
        </button>
      </div>
    )
  }

  if (today.status.state === 'connecting') return <p className="text-sm text-[#5e5d58]">{t.connecting}</p>

  if (today.status.state === 'off') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-[#5e5d58]">{t.empty}</p>
        <button type="button" onClick={onOpenArms} className="min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong">
          {t.connect}
        </button>
      </div>
    )
  }

  if (events.length === 0) return <p className="text-sm text-[#5e5d58]">{t.noEvents}</p>

  const ms = now.getTime()
  const phase = (e: CalendarEvent): 'allDay' | 'past' | 'now' | 'later' =>
    e.allDay ? 'allDay' : new Date(e.end).getTime() <= ms ? 'past' : new Date(e.start).getTime() <= ms ? 'now' : 'later'

  return (
    <ul className="flex flex-col gap-1">
      {events.map((e) => {
        const p = phase(e)
        const row = (
          <>
            <span className="w-24 shrink-0 text-xs tabular-nums text-[#5e5d58]">{e.allDay ? t.allDay : `${hhmm(e.start)}~${hhmm(e.end)}`}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
            {p === 'now' && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">{t.now}</span>}
          </>
        )
        const cls = `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
          p === 'now' ? 'bg-accent-soft font-semibold text-accent-strong' : p === 'past' ? 'text-[#8a8983]' : 'text-ink'
        }`
        return (
          <li key={e.id} data-phase={p} aria-current={p === 'now' ? 'time' : undefined}>
            {e.url ? (
              <button type="button" aria-label={t.eventLabel(e.title)} onClick={() => onOpenEvent(e.id)} className={`${cls} hover:bg-black/5`}>
                {row}
              </button>
            ) : (
              <div className={cls}>{row}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

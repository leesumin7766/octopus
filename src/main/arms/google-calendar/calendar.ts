import type { CalendarEvent } from '../../../shared/calendar/types'

// Google Calendar 응답 처리와 "오늘" 범위 계산. 순수 함수.

/** 사용자의 로컬 시간대 기준 오늘 0시 ~ 내일 0시(RFC 3339, UTC 표기). 서머타임 날에도 달력 날짜 기준으로 맞는다. */
export function todayRange(now: Date): { timeMin: string; timeMax: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}

function httpsOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

interface RawEvent {
  id?: unknown
  summary?: unknown
  status?: unknown
  htmlLink?: unknown
  start?: { date?: unknown; dateTime?: unknown }
  end?: { date?: unknown; dateTime?: unknown }
}

/** events.list 응답을 일정 목록으로: 취소된 일정·모양이 틀린 항목은 버리고, 종일 일정을 먼저, 나머지는 시작 시각 순으로 정렬한다. */
export function parseEvents(body: unknown): CalendarEvent[] {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return []
  const events: CalendarEvent[] = []
  for (const raw of items as RawEvent[]) {
    if (typeof raw !== 'object' || raw === null || raw.status === 'cancelled') continue
    if (typeof raw.id !== 'string' || raw.id === '') continue
    const allDay = typeof raw.start?.date === 'string'
    const start = allDay ? raw.start?.date : raw.start?.dateTime
    const end = allDay ? raw.end?.date : raw.end?.dateTime
    if (typeof start !== 'string' || typeof end !== 'string') continue
    const title = typeof raw.summary === 'string' && raw.summary.trim() !== '' ? raw.summary.trim().slice(0, 300) : '(제목 없음)'
    events.push({ id: raw.id, title, start, end, allDay, url: httpsOrNull(raw.htmlLink) })
  }
  return events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
}

const pad = (n: number): string => String(n).padStart(2, '0')
const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 지시하기 도구가 모델에 돌려줄 글 한 줄 */
export function describeEvent(e: CalendarEvent): string {
  return e.allDay ? `- 종일 ${e.title}` : `- ${hhmm(e.start)}~${hhmm(e.end)} ${e.title}`
}

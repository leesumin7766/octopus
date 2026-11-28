import { addDays, daysInMonth, formatDate, mondayIndex, parseDate, weekdayOf } from './dates'
import { firstOccurrence, withAnchor } from './repeat'
import type { RepeatRule, TaskPriority } from './types'
import { isValidDateString } from '../validation/task'

/** Task 를 만들 때 그대로 넘길 수 있는 모양. */
export interface QuickParseResult {
  title: string
  date: string | null
  time: string | null
  project: string | null
  priority: TaskPriority
  repeat: RepeatRule | null
  bucket: 'inbox' | 'scheduled'
  /** 날짜가 어디서 왔는지: 문장 / 호출한 쪽이 준 기본 날짜 / 날짜 없음 */
  dateFrom: 'text' | 'default' | null
}

export interface QuickParseOptions {
  /** 문장에 날짜가 없을 때 쓸 날짜(YYYY-MM-DD) */
  defaultDate?: string
  /** 문장에 시각이 없을 때 쓸 시각(HH:MM) */
  defaultTime?: string
}

type Kind = 'date' | 'time' | 'project' | 'priority' | 'repeat'

interface State {
  date: string | null
  time: string | null
  project: string | null
  priority: TaskPriority
  repeat: RepeatRule | null
}

interface Match {
  /** null 이면 "알아보지 못했지만 이 낱말들은 한 덩어리"라는 뜻이라 그대로 제목에 남긴다. */
  kind: Kind | null
  /** 차지하는 낱말 수 */
  consumed: number
  apply: (state: State) => void
}

const WEEKDAYS = new Map<string, number>([
  ['일', 0], ['월', 1], ['화', 2], ['수', 3], ['목', 4], ['금', 5], ['토', 6],
  ['일요일', 0], ['월요일', 1], ['화요일', 2], ['수요일', 3], ['목요일', 4], ['금요일', 5], ['토요일', 6]
])

const PRIORITIES = new Map<string, TaskPriority>([
  ['!높음', 3], ['!중간', 2], ['!낮음', 1], ['!3', 3], ['!2', 2], ['!1', 1]
])

function weekdayOfToken(token: string | undefined): number | null {
  return token === undefined ? null : (WEEKDAYS.get(token) ?? null)
}

/** 오늘 이상인 가장 가까운 month/day. 올해 날짜가 지났으면 내년(2/29 는 다음 윤년). */
function upcomingMonthDay(month: number, day: number, today: string): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const { year } = parseDate(today)
  for (let y = year; y <= year + 8; y++) {
    if (day > daysInMonth(y, month)) continue
    const candidate = formatDate(y, month, day)
    if (candidate >= today) return candidate
  }
  return null
}

function dateMatch(consumed: number, date: string | null): Match | null {
  return date === null ? null : { kind: 'date', consumed, apply: (s) => void (s.date = date) }
}

function matchDate(tokens: string[], i: number, today: string): Match | null {
  const token = tokens[i]

  if (token === '오늘') return dateMatch(1, today)
  if (token === '내일') return dateMatch(1, addDays(today, 1))
  if (token === '모레') return dateMatch(1, addDays(today, 2))

  // 요일: 오늘을 포함해 가장 가까운 그 요일
  const weekday = weekdayOfToken(token)
  if (weekday !== null) {
    return dateMatch(1, addDays(today, (weekday - weekdayOf(today) + 7) % 7))
  }

  // 다음주 월: 다음 주(월요일 시작)의 그 요일
  if (token === '다음주') {
    const target = weekdayOfToken(tokens[i + 1])
    if (target === null) return null
    const nextMonday = addDays(today, 7 - mondayIndex(weekdayOf(today)))
    return dateMatch(2, addDays(nextMonday, mondayIndex(target)))
  }

  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(token)
  if (slash) return dateMatch(1, upcomingMonthDay(Number(slash[1]), Number(slash[2]), today))

  const joined = /^(\d{1,2})월(\d{1,2})일$/.exec(token)
  if (joined) return dateMatch(1, upcomingMonthDay(Number(joined[1]), Number(joined[2]), today))

  const month = /^(\d{1,2})월$/.exec(token)
  const day = /^(\d{1,2})일$/.exec(tokens[i + 1] ?? '')
  if (month && day) return dateMatch(2, upcomingMonthDay(Number(month[1]), Number(day[1]), today))

  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return dateMatch(1, isValidDateString(token) ? token : null)

  return null
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function unrecognized(consumed: number): Match {
  return { kind: null, consumed, apply: () => {} }
}

function matchTime(tokens: string[], i: number): Match | null {
  let at = i
  let meridiem: 'am' | 'pm' | null = null
  if (tokens[at] === '오전' || tokens[at] === '오후') {
    meridiem = tokens[at] === '오전' ? 'am' : 'pm'
    at++
  }

  const body = tokens[at]
  if (body === undefined) return null

  let hour: number
  let minute: number
  let used = at - i + 1
  let bareHours = false // "N시" 형태: 오전·오후가 없을 때 1~6 시를 오후로 본다

  const colon = /^(\d{1,2}):(\d{2})$/.exec(body)
  const korean = /^(\d{1,2})시(?:(\d{1,2})분|(반))?$/.exec(body)
  if (colon) {
    hour = Number(colon[1])
    minute = Number(colon[2])
  } else if (korean) {
    hour = Number(korean[1])
    minute = korean[3] ? 30 : korean[2] !== undefined ? Number(korean[2]) : 0
    bareHours = true
    if (korean[2] === undefined && !korean[3]) {
      // "3시 30분": 분이 다음 낱말에 따로 있는 경우
      const separate = /^(\d{1,2})분$/.exec(tokens[at + 1] ?? '')
      if (separate) {
        minute = Number(separate[1])
        used++
      }
    }
  } else {
    return null
  }

  if (minute > 59) return meridiem ? unrecognized(used) : null

  if (meridiem) {
    // 오후 15시 처럼 앞뒤가 어긋나면 두 낱말 모두 제목에 남긴다.
    if (hour < 1 || hour > 12) return unrecognized(used)
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0)
  } else {
    if (hour > 23) return null
    if (bareHours && hour >= 1 && hour <= 6) hour += 12
  }

  const time = formatTime(hour, minute)
  return { kind: 'time', consumed: used, apply: (s) => void (s.time = time) }
}

function matchRepeat(tokens: string[], i: number): Match | null {
  const token = tokens[i]
  const set = (repeat: RepeatRule, consumed: number): Match => ({
    kind: 'repeat',
    consumed,
    apply: (s) => void (s.repeat = repeat)
  })

  if (token === '매일') return set({ freq: 'daily', interval: 1 }, 1)
  if (token === '평일') return set({ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, 1)
  if (token === '매년') return set({ freq: 'yearly', interval: 1 }, 1)

  if (token === '매주') {
    const weekdays: number[] = []
    let next = weekdayOfToken(tokens[i + 1 + weekdays.length])
    while (next !== null) {
      weekdays.push(next)
      next = weekdayOfToken(tokens[i + 1 + weekdays.length])
    }
    const unique = [...new Set(weekdays)].sort((a, b) => a - b)
    return set(
      unique.length > 0 ? { freq: 'weekly', interval: 1, byWeekday: unique } : { freq: 'weekly', interval: 1 },
      1 + weekdays.length
    )
  }

  if (token === '매월') {
    const day = /^(\d{1,2})일$/.exec(tokens[i + 1] ?? '')
    const monthDay = day ? Number(day[1]) : 0
    return monthDay >= 1 && monthDay <= 31
      ? set({ freq: 'monthly', interval: 1, byMonthDay: monthDay }, 2)
      : set({ freq: 'monthly', interval: 1 }, 1)
  }

  return null
}

function matchProject(tokens: string[], i: number): Match | null {
  const token = tokens[i]
  if (!token.startsWith('#') || token.length < 2) return null
  const project = token.slice(1)
  return { kind: 'project', consumed: 1, apply: (s) => void (s.project = project) }
}

function matchPriority(tokens: string[], i: number): Match | null {
  const priority = PRIORITIES.get(tokens[i])
  if (priority === undefined) return null
  return { kind: 'priority', consumed: 1, apply: (s) => void (s.priority = priority) }
}

/**
 * "내일 오후 3시 보고서 #업무 !높음" 같은 한 줄 입력을 Task 필드로 바꾼다.
 *
 * - 공백으로 나뉜 낱말 단위로만 알아본다("오늘의" 는 제목).
 * - 알아본 낱말은 제목에서 빼고, 같은 종류가 또 나오면 첫 번째만 쓰고 나머지는 제목에 남긴다.
 * - 제목이 비면 원문 전체를 제목으로 쓴다(날짜 등은 그대로 적용).
 * - today 는 YYYY-MM-DD. 시계를 읽지 않는 순수 함수다.
 * - options.defaultDate·defaultTime 은 문장에 날짜·시각이 없을 때만 쓴다(문장이 이긴다).
 */
export function parseQuickInput(text: string, today: string, options?: QuickParseOptions): QuickParseResult {
  const original = text.trim()
  const tokens = original === '' ? [] : original.split(/\s+/)

  const state: State = { date: null, time: null, project: null, priority: 0, repeat: null }
  const taken = new Set<Kind>()
  const titleWords: string[] = []

  let i = 0
  while (i < tokens.length) {
    const match =
      matchRepeat(tokens, i) ??
      matchProject(tokens, i) ??
      matchPriority(tokens, i) ??
      matchDate(tokens, i, today) ??
      matchTime(tokens, i)

    if (!match) {
      titleWords.push(tokens[i])
      i++
      continue
    }

    if (match.kind === null || taken.has(match.kind)) {
      // 알아보지 못한 덩어리, 또는 두 번째 같은 종류는 낱말 전체를 제목에 남긴다.
      titleWords.push(...tokens.slice(i, i + match.consumed))
    } else {
      taken.add(match.kind)
      match.apply(state)
    }
    i += match.consumed
  }

  const defaultDate = options?.defaultDate ?? null
  const time = state.time ?? options?.defaultTime ?? null
  let date = state.date
  let dateFrom: QuickParseResult['dateFrom'] = date === null ? null : 'text'
  if (date === null) {
    if (state.repeat) {
      date = firstOccurrence(state.repeat, defaultDate ?? today)
      dateFrom = defaultDate !== null && date === defaultDate ? 'default' : null
    } else if (defaultDate !== null) {
      date = defaultDate
      dateFrom = 'default'
    } else if (time) date = today
  }

  // 날짜 없이 "매월" 만 쓴 경우: 정해진 날짜의 일을 매월 날짜로 삼는다(31일이 짧은 달에 밀려도 돌아오도록).
  let repeat = state.repeat
  if (repeat?.freq === 'monthly' && repeat.byMonthDay === undefined && date !== null) {
    repeat = { ...repeat, byMonthDay: parseDate(date).day }
  }
  // 새 반복의 기준일: 그 할 일의 날짜(매년이면 그 날짜의 월·일도 규칙에 넣는다).
  if (repeat && date !== null) repeat = withAnchor(repeat, date)

  return {
    title: titleWords.length > 0 ? titleWords.join(' ') : original,
    date,
    time,
    project: state.project,
    priority: state.priority,
    repeat,
    bucket: date === null ? 'inbox' : 'scheduled',
    dateFrom
  }
}

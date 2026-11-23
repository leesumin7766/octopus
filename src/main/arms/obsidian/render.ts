import type { RepeatRule, Task } from '../../../shared/tasks/types'

// 옵시디언으로 내보낼 파일 내용을 만든다. 순수 함수. 형식: CLAUDE.md 6.3
//   맨 위 주석 · ## 지난 할 일 / ## 오늘 · <날짜 요일> / ## 예정 / ## 나중에 / (## 수신함) · (적어 넣기 구역)
//   줄: "- [ ] 제목 HH:mm (마감 MM/DD) #프로젝트 (반복 설명)", 오늘 끝낸 것은 "- [x]"

export const FILE_COMMENT = '<!-- Octopus 가 덮어쓰는 파일입니다. 고치려면 Octopus 에서. -->'
export const WRITING_HEADING = '## 적어 넣기'
export const WRITING_NOTE = '<!-- 아래에 "- [ ] 할 일" 을 적으면 Octopus 수신함으로 가져가고, 가져간 줄은 지워져요. -->'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export interface ExportData {
  /** 오늘 YYYY-MM-DD(로컬) */
  today: string
  /** 날짜가 오늘보다 앞선 열린 할 일 */
  overdue: Task[]
  /** 날짜가 오늘인 열린 할 일 */
  dueToday: Task[]
  upcoming: Task[]
  someday: Task[]
  inbox: Task[]
  /** 오늘 끝낸 할 일 */
  doneToday: Task[]
}

/**
 * 제목·프로젝트 같은 글자를 한 줄로 정리한다: 줄바꿈·연속 공백은 공백 하나로, 마크다운 특수 문자는 \ 로 막는다
 * (옵시디언이 체크박스·링크·태그·강조·표·주석으로 해석하지 않게).
 */
export function cleanText(text: string): string {
  return text
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[\\`*_[\]<>#|~]/g, (c) => `\\${c}`)
}

/** #태그 로 쓸 수 있는 모양: 공백은 -, 태그에 못 쓰는 글자는 뺀다. 남는 게 없으면 null. */
export function toTag(text: string): string | null {
  const tag = text
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
  return /[\p{L}\p{N}]/u.test(tag) ? `#${tag}` : null
}

const mmdd = (date: string): string => `${date.slice(5, 7)}/${date.slice(8, 10)}`

/** 반복 규칙을 짧은 말로 */
export function describeRepeat(rule: RepeatRule): string {
  const n = rule.interval
  switch (rule.freq) {
    case 'daily':
      return n === 1 ? '매일' : `${n}일마다`
    case 'weekly': {
      const days = [...new Set(rule.byWeekday ?? [])].sort((a, b) => a - b)
      if (n === 1 && days.join() === '1,2,3,4,5') return '평일'
      const names = days.map((d) => WEEKDAYS[d]).join(' ')
      const head = n === 1 ? '매주' : `${n}주마다`
      return names ? `${head} ${names}` : head
    }
    case 'monthly':
      return n !== 1 ? `${n}개월마다` : rule.byMonthDay ? `매월 ${rule.byMonthDay}일` : '매월'
    case 'yearly':
      return n === 1 ? '매년' : `${n}년마다`
  }
}

interface LineOptions {
  done?: boolean
  /** 날짜(MM/DD)도 보여 준다(지난 할 일·예정) */
  showDate?: boolean
}

export function taskLine(task: Task, options: LineOptions = {}): string {
  const parts: string[] = [`- [${options.done ? 'x' : ' '}] ${cleanText(task.title) || '(제목 없음)'}`]
  const when = [options.showDate && task.date ? mmdd(task.date) : '', task.time ?? ''].filter(Boolean).join(' ')
  if (when) parts.push(when)
  if (task.deadline) parts.push(`(마감 ${mmdd(task.deadline)})`)
  const tags = [task.project, ...task.tags].map((t) => (t ? toTag(t) : null)).filter((t): t is string => t !== null)
  parts.push(...new Set(tags))
  if (task.repeat) parts.push(`(${cleanText(describeRepeat(task.repeat))})`)
  return parts.join(' ')
}

/** "11월 23일 월요일" */
export function todayHeading(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  return `${m}월 ${d}일 ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}요일`
}

export interface RenderOptions {
  /** "적어 넣기" 구역에 남길 줄들. null 이면 그 구역을 만들지 않는다(내보내기만). */
  writingLines: string[] | null
}

export function renderExport(data: ExportData, options: RenderOptions = { writingLines: null }): string {
  const plain = (tasks: Task[]): Task[] => tasks.filter((t) => t.routineId === null) // 루틴 항목은 오늘 구역에만
  const out: string[] = [FILE_COMMENT, '']

  const section = (title: string, lines: string[]): void => {
    out.push(`## ${title}`, ...lines, '')
  }

  const overdue = plain(data.overdue)
  if (overdue.length > 0) section('지난 할 일', overdue.map((t) => taskLine(t, { showDate: true })))
  section(`오늘 · ${todayHeading(data.today)}`, [
    ...data.dueToday.map((t) => taskLine(t)),
    ...data.doneToday.map((t) => taskLine(t, { done: true }))
  ])
  section('예정', plain(data.upcoming).map((t) => taskLine(t, { showDate: true })))
  section('나중에', plain(data.someday).map((t) => taskLine(t)))
  const inbox = plain(data.inbox)
  if (inbox.length > 0) section('수신함', inbox.map((t) => taskLine(t)))

  if (options.writingLines !== null) {
    out.push(WRITING_HEADING, WRITING_NOTE, ...options.writingLines, '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n')
}

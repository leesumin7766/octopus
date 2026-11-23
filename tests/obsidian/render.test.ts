import { describe, expect, it } from 'vitest'
import { cleanText, describeRepeat, FILE_COMMENT, renderExport, taskLine, toTag, todayHeading, WRITING_HEADING, WRITING_NOTE, type ExportData } from '../../src/main/arms/obsidian/render'
import type { Task } from '../../src/shared/tasks/types'

let n = 0
const task = (over: Partial<Task> = {}): Task => ({
  id: `T${n++}`,
  title: '할 일',
  notes: '',
  status: 'open',
  bucket: 'inbox',
  date: null,
  time: null,
  deadline: null,
  priority: 0,
  project: null,
  tags: [],
  repeat: null,
  routineId: null,
  source: null,
  order: n,
  createdAt: '',
  updatedAt: '',
  doneAt: null,
  ...over
})

const data = (over: Partial<ExportData> = {}): ExportData => ({ today: '2026-03-10', overdue: [], dueToday: [], upcoming: [], someday: [], inbox: [], doneToday: [], ...over })

describe('text cleaning', () => {
  it('turns newlines, tabs and runs of spaces into one space', () => {
    expect(cleanText('첫 줄\n둘째 줄\r\n\t셋째   줄')).toBe('첫 줄 둘째 줄 셋째 줄')
    expect(cleanText('  앞뒤 공백  ')).toBe('앞뒤 공백')
    expect(cleanText('a b c')).toBe('a b c')
  })

  it('escapes the characters Obsidian would treat as markdown (links, tags, emphasis, code, tables, html, comments)', () => {
    expect(cleanText('[[링크]] #태그 *굵게* _기울임_ `코드` <b>html</b> a|b ~~취소~~ \\역슬래시')).toBe(
      '\\[\\[링크\\]\\] \\#태그 \\*굵게\\* \\_기울임\\_ \\`코드\\` \\<b\\>html\\</b\\> a\\|b \\~\\~취소\\~\\~ \\\\역슬래시'
    )
    expect(cleanText('<!-- 주석 -->')).toBe('\\<!-- 주석 --\\>')
  })

  it('a title can never become a checkbox line, a heading or a comment of its own', () => {
    const line = taskLine(task({ title: '## 제목처럼\n- [ ] 가짜 할 일\n<!-- x -->' }))
    expect(line.split('\n')).toHaveLength(1)
    expect(line.startsWith('- [ ] ')).toBe(true)
    expect(line).not.toMatch(/(?<!\\)<!--/) // 이스케이프되지 않은 주석 시작은 없다
    expect(line).not.toContain('\\n')
    expect(line.slice(6)).not.toMatch(/^#/)
  })

  it('tags: spaces become hyphens, unusable characters are dropped, nothing left means no tag', () => {
    expect(toTag('업무 프로젝트')).toBe('#업무-프로젝트')
    expect(toTag('a/b_c-d')).toBe('#a/b_c-d')
    expect(toTag('!@$%')).toBeNull()
    expect(toTag('  ')).toBeNull()
    expect(toTag('v2.0 (최종)')).toBe('#v20-최종')
  })
})

describe('repeat description', () => {
  it.each([
    [{ freq: 'daily', interval: 1 }, '매일'],
    [{ freq: 'daily', interval: 3 }, '3일마다'],
    [{ freq: 'weekly', interval: 1, byWeekday: [1] }, '매주 월'],
    [{ freq: 'weekly', interval: 2, byWeekday: [1, 3] }, '2주마다 월 수'],
    [{ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, '평일'],
    [{ freq: 'monthly', interval: 1, byMonthDay: 15 }, '매월 15일'],
    [{ freq: 'monthly', interval: 1 }, '매월'],
    [{ freq: 'monthly', interval: 3 }, '3개월마다'],
    [{ freq: 'yearly', interval: 1 }, '매년']
  ] as const)('%j → %s', (rule, text) => {
    expect(describeRepeat(rule as never)).toBe(text)
  })
})

describe('task lines', () => {
  it('"- [ ] 제목 HH:mm (마감 MM/DD) #프로젝트 (반복)" in that order', () => {
    const line = taskLine(task({ title: '보고서', time: '15:00', deadline: '2026-03-12', project: '업무', repeat: { freq: 'weekly', interval: 1, byWeekday: [1] } }))
    expect(line).toBe('- [ ] 보고서 15:00 (마감 03/12) #업무 (매주 월)')
  })

  it('only what exists is written; a done task is [x]', () => {
    expect(taskLine(task({ title: '간단' }))).toBe('- [ ] 간단')
    expect(taskLine(task({ title: '끝' }), { done: true })).toBe('- [x] 끝')
  })

  it('past and upcoming lines show the date (MM/DD) before the time', () => {
    expect(taskLine(task({ title: '치과', date: '2026-03-13', time: '14:00' }), { showDate: true })).toBe('- [ ] 치과 03/13 14:00')
    expect(taskLine(task({ title: '치과', date: '2026-03-13' }), { showDate: true })).toBe('- [ ] 치과 03/13')
    expect(taskLine(task({ title: '오늘 것', date: '2026-03-10', time: '09:00' }))).toBe('- [ ] 오늘 것 09:00')
  })

  it('extra tags are added once; an empty title is shown as 제목 없음', () => {
    expect(taskLine(task({ title: 'x', project: '업무', tags: ['업무', '급함'] }))).toBe('- [ ] x #업무 #급함')
    expect(taskLine(task({ title: '   ' }))).toContain('(제목 없음)')
  })
})

describe('the exported file', () => {
  it('starts with the overwrite comment and has today\'s heading with date and weekday (always), other sections only when they have lines', () => {
    const out = renderExport(data())
    expect(out.startsWith(`${FILE_COMMENT}\n`)).toBe(true)
    expect(out).toContain('## 오늘 · 3월 10일 화요일')
    expect(out).not.toContain('## 지난 할 일')
    expect(out).not.toContain('## 수신함')
    expect(out).toContain('## 예정')
    expect(out).toContain('## 나중에')
    expect(out.endsWith('\n')).toBe(true)
    expect(out).not.toMatch(/\n{3,}/)
    expect(todayHeading('2026-12-31')).toBe('12월 31일 목요일')
  })

  it('has the sections in order: 지난 할 일, 오늘, 예정, 나중에, 수신함', () => {
    const out = renderExport(
      data({
        overdue: [task({ title: '밀린 일', date: '2026-03-08' })],
        dueToday: [task({ title: '오늘 일', date: '2026-03-10' })],
        upcoming: [task({ title: '다음 일', date: '2026-03-12' })],
        someday: [task({ title: '언젠가' })],
        inbox: [task({ title: '새 일' })]
      })
    )
    const headings = out.split('\n').filter((l) => l.startsWith('## '))
    expect(headings).toEqual(['## 지난 할 일', '## 오늘 · 3월 10일 화요일', '## 예정', '## 나중에', '## 수신함'])
    expect(out).toContain('- [ ] 밀린 일 03/08')
    expect(out).toContain('- [ ] 다음 일 03/12')
  })

  it('lists today\'s open tasks first and today\'s finished ones as [x]', () => {
    const out = renderExport(data({ dueToday: [task({ title: '열린 일' })], doneToday: [task({ title: '끝낸 일', status: 'done' })] }))
    const today = out.split('## 예정')[0]
    expect(today.indexOf('- [ ] 열린 일')).toBeLessThan(today.indexOf('- [x] 끝낸 일'))
  })

  it('routine items appear only in today\'s section (never in past, upcoming, someday or inbox)', () => {
    const routine = (title: string) => task({ title, routineId: 'R1' })
    const out = renderExport(
      data({ overdue: [routine('어제 루틴')], dueToday: [routine('오늘 루틴')], doneToday: [routine('끝낸 루틴')], upcoming: [routine('내일 루틴')], someday: [routine('언젠가 루틴')], inbox: [routine('수신함 루틴')] })
    )
    expect(out).toContain('- [ ] 오늘 루틴')
    expect(out).toContain('- [x] 끝낸 루틴')
    for (const gone of ['어제 루틴', '내일 루틴', '언젠가 루틴', '수신함 루틴']) expect(out).not.toContain(gone)
    expect(out).not.toContain('## 지난 할 일')
  })

  it('without a writing section (export only) there is no "적어 넣기"; with one it is last, with the note and the kept lines', () => {
    expect(renderExport(data())).not.toContain(WRITING_HEADING)
    const out = renderExport(data({ dueToday: [task({ title: 'a' })] }), { writingLines: ['내가 적어 둔 메모'] })
    expect(out.trimEnd().endsWith('내가 적어 둔 메모')).toBe(true)
    expect(out).toContain(`${WRITING_HEADING}\n${WRITING_NOTE}\n내가 적어 둔 메모`)
    expect(renderExport(data(), { writingLines: [] }).trimEnd().endsWith(WRITING_NOTE)).toBe(true)
  })

  it('is deterministic: the same data gives the same text', () => {
    const d = data({ dueToday: [task({ title: 'a', time: '09:00' })], inbox: [task({ title: 'b' })] })
    expect(renderExport(d)).toBe(renderExport(d))
  })
})

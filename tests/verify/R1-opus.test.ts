// R1 독립 검증(Opus): 반복을 말로 입력, 한 글자 '일' 은 날짜가 아님. 해석 결과와 미리보기 글.
import { describe, expect, it } from 'vitest'
import { parseQuickInput } from '../../src/shared/tasks/quickParse'
import { formatRepeat } from '../../src/renderer/tasks/format'

const TODAY = '2026-11-26' // 목요일
const p = (text: string) => parseQuickInput(text, TODAY)

describe('R1 (Opus) spoken repeats', () => {
  it('격주 + 요일 with project and priority: everything is understood and the title stays clean', () => {
    const r = p('격주 월 주간 회의 #업무 !높음')
    expect(r.title).toBe('주간 회의')
    expect(r.project).toBe('업무')
    expect(r.priority).toBeGreaterThan(0)
    expect(r.repeat).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [1] })
    expect(r.date).toBe('2026-11-30') // 다음 월요일
    expect(formatRepeat(r.repeat!)).toContain('2주')
  })

  it('N주마다 평일 / N일마다 / N개월마다 read as their rules and preview with the number', () => {
    const weekdays = p('2주마다 평일 점검')
    expect(weekdays.repeat).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [1, 2, 3, 4, 5] })
    expect(weekdays.title).toBe('점검')

    const days = p('3일마다 물주기')
    expect(days.repeat).toMatchObject({ freq: 'daily', interval: 3 })
    expect(days.date).toBe(TODAY)
    expect(formatRepeat(days.repeat!)).toContain('3일')

    const months = p('2개월마다 정산')
    expect(months.repeat).toMatchObject({ freq: 'monthly', interval: 2, byMonthDay: 26 })
    expect(formatRepeat(months.repeat!)).toContain('2개월')
  })

  it('a sentence date sets the first occurrence and the anchor for N일마다', () => {
    const r = p('12월 1일 3일마다 점검')
    expect(r.date).toBe('2026-12-01')
    expect(r.repeat).toMatchObject({ freq: 'daily', interval: 3 })
  })

  it('out-of-range intervals are not repeats; the words stay in the title', () => {
    for (const text of ['0일마다 점검', '100주마다 점검']) {
      const r = p(text)
      expect(r.repeat).toBeNull()
      expect(r.title).toBe(text)
    }
  })

  it('existing repeats still work (매일, 매주 월 수, 평일, 매월 15일)', () => {
    expect(p('매일 운동').repeat).toMatchObject({ freq: 'daily', interval: 1 })
    expect(p('매주 월 수 운동').repeat).toMatchObject({ freq: 'weekly', interval: 1, byWeekday: [1, 3] })
    expect(p('평일 출근').repeat).toMatchObject({ freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] })
    expect(p('매월 15일 정산').repeat).toMatchObject({ freq: 'monthly', byMonthDay: 15 })
  })
})

describe('R1 (Opus) a lone 일 is not Sunday', () => {
  it('"청소 일", "일 청소", "급한 일 처리" have no date and keep every word', () => {
    for (const text of ['청소 일', '일 청소', '급한 일 처리']) {
      const r = p(text)
      expect(r.date, text).toBeNull()
      expect(r.title, text).toBe(text)
      expect(r.bucket).toBe('inbox')
    }
  })

  it('Sunday is still understood when it is clear', () => {
    expect(p('일요일 청소').date).toBe('2026-11-29')
    expect(p('다음주 일 청소').date).toBe('2026-12-06')
    expect(p('매주 일 청소').repeat).toMatchObject({ freq: 'weekly', byWeekday: [0] })
    expect(p('격주 일 청소').repeat).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [0] })
  })

  it('other one-letter weekdays and day-of-month words are unchanged', () => {
    expect(p('월 회의').date).toBe('2026-11-30')
    expect(p('금 회식').date).toBe('2026-11-27')
    // '3일' 혼자는 예전에도 날짜가 아니었다(날짜는 '12월 3일'·'12/3'). 그대로인지 확인.
    expect(p('3일 회의')).toMatchObject({ date: null, title: '3일 회의' })
    expect(p('12월 3일 회의')).toMatchObject({ date: '2026-12-03', title: '회의' })
  })
})

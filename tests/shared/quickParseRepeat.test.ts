import { describe, expect, it } from 'vitest'
import { formatRepeat } from '../../src/renderer/tasks/format'
import { parseQuickInput } from '../../src/shared/tasks/quickParse'

// 2026-11-22 는 일요일, 11-23 은 월요일.
const SUNDAY = '2026-11-22'
const parse = (text: string, today = SUNDAY) => parseQuickInput(text, today)

describe('repeat in words', () => {
  it('격주 월 = every 2 weeks on Monday, first Monday, anchored there', () => {
    expect(parse('격주 월 회의')).toMatchObject({
      title: '회의',
      date: '2026-11-23',
      repeat: { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-11-23' }
    })
  })

  it('격주 with several weekdays, and 격주 일 stays Sunday', () => {
    expect(parse('격주 월 수 스터디').repeat).toMatchObject({ interval: 2, byWeekday: [1, 3] })
    expect(parse('격주 일 정리')).toMatchObject({ date: SUNDAY, repeat: { freq: 'weekly', interval: 2, byWeekday: [0] } })
  })

  it('N주마다 월 수 / N주마다 평일', () => {
    expect(parse('3주마다 월 수 회의').repeat).toMatchObject({ freq: 'weekly', interval: 3, byWeekday: [1, 3] })
    expect(parse('2주마다 평일 점검')).toMatchObject({ title: '점검', repeat: { freq: 'weekly', interval: 2, byWeekday: [1, 2, 3, 4, 5] }, date: '2026-11-23' })
    expect(parse('2주마다 점검').repeat).toMatchObject({ freq: 'weekly', interval: 2 })
  })

  it('N일마다 starts today', () => {
    expect(parse('3일마다 물주기')).toMatchObject({
      title: '물주기',
      date: SUNDAY,
      repeat: { freq: 'daily', interval: 3, anchor: SUNDAY }
    })
  })

  it('N개월마다 uses that date as the day of month', () => {
    expect(parse('2개월마다 점검')).toMatchObject({
      date: SUNDAY,
      repeat: { freq: 'monthly', interval: 2, byMonthDay: 22, anchor: SUNDAY }
    })
    expect(parse('12/31 3개월마다 정산').repeat).toMatchObject({ freq: 'monthly', interval: 3, byMonthDay: 31, anchor: '2026-12-31' })
  })

  it('N년마다', () => {
    expect(parse('2년마다 갱신').repeat).toMatchObject({ freq: 'yearly', interval: 2, byMonth: 11, byMonthDay: 22 })
  })

  it('an interval outside 1~99 is not a repeat; the words stay in the title', () => {
    expect(parse('0일마다 정리')).toMatchObject({ title: '0일마다 정리', repeat: null, date: null })
    expect(parse('100주마다 정리')).toMatchObject({ repeat: null })
  })

  it('the preview chip text reads naturally', () => {
    expect(formatRepeat(parse('격주 월 회의').repeat!)).toContain('2주')
    expect(formatRepeat(parse('3일마다 물주기').repeat!)).toContain('3일')
    expect(formatRepeat(parse('2개월마다 점검').repeat!)).toContain('2개월')
  })

  it('a text date still wins; the anchor is that date', () => {
    expect(parse('12/7 격주 월 회의')).toMatchObject({ date: '2026-12-07', repeat: { interval: 2, anchor: '2026-12-07' } })
  })
})

describe('the single character 일 is not a date', () => {
  it('"청소 일" keeps the title and has no date', () => {
    expect(parse('청소 일')).toMatchObject({ title: '청소 일', date: null, bucket: 'inbox' })
    expect(parse('일 청소')).toMatchObject({ title: '일 청소', date: null })
  })

  it('일요일, 다음주 일, 이번주 일, 매주 일, 격주 일 are Sunday', () => {
    expect(parse('일요일 청소')).toMatchObject({ title: '청소', date: SUNDAY })
    expect(parse('다음주 일 청소', '2026-11-23').date).toBe('2026-12-06')
    expect(parse('이번주 일 청소', '2026-11-23').date).toBe('2026-11-29')
    expect(parse('매주 일 청소').repeat).toMatchObject({ freq: 'weekly', byWeekday: [0] })
    expect(parse('격주 일 청소').repeat).toMatchObject({ interval: 2, byWeekday: [0] })
  })

  it('the other one-character weekdays still work (월~토)', () => {
    expect(parse('월 회의')).toMatchObject({ title: '회의', date: '2026-11-23' })
    expect(parse('토 청소').date).toBe('2026-11-28')
    expect(parse('이번주 수 회의', SUNDAY).date).toBe('2026-11-18') // 일요일은 그 주의 마지막 날이라 이번 주 수요일은 지난 날
  })
})

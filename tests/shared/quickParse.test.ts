import { describe, expect, it } from 'vitest'
import { parseQuickInput } from '../../src/shared/tasks/quickParse'
import { validateTaskFields } from '../../src/shared/validation/task'

// 2026-11-22 는 일요일, 2026-11-23 은 월요일.
const SUNDAY = '2026-11-22'
const MONDAY = '2026-11-23'

const parse = (text: string, today = SUNDAY) => parseQuickInput(text, today)

describe('parseQuickInput', () => {
  describe('plain text', () => {
    it('a plain title goes to the inbox with defaults', () => {
      expect(parse('우유 사기')).toEqual({
        title: '우유 사기',
        date: null,
        time: null,
        project: null,
        priority: 0,
        repeat: null,
        bucket: 'inbox',
        dateFrom: null
      })
    })

    it('collapses extra spaces', () => {
      expect(parse('  내일   회의  ').title).toBe('회의')
    })

    it('empty input gives an empty title', () => {
      expect(parse('')).toMatchObject({ title: '', date: null, bucket: 'inbox' })
      expect(parse('   ')).toMatchObject({ title: '' })
    })

    it('keeps the order of the remaining words', () => {
      expect(parse('보고서 내일 작성 #업무 마무리').title).toBe('보고서 작성 마무리')
    })
  })

  describe('whole words only', () => {
    it('ignores keywords that are part of a longer word', () => {
      expect(parse('오늘의 회고')).toMatchObject({ title: '오늘의 회고', date: null, bucket: 'inbox' })
      expect(parse('내일모레 약속').date).toBeNull()
      expect(parse('월급 정리').date).toBeNull()
      expect(parse('3시간 공부').time).toBeNull()
      expect(parse('매일매일 운동').repeat).toBeNull()
    })
  })

  describe('dates', () => {
    it('오늘 / 내일 / 모레', () => {
      expect(parse('오늘 회의')).toMatchObject({ title: '회의', date: '2026-11-22', bucket: 'scheduled' })
      expect(parse('내일 회의').date).toBe('2026-11-23')
      expect(parse('모레 회의').date).toBe('2026-11-24')
    })

    it('a weekday is the nearest one counting today', () => {
      expect(parse('월 회의').date).toBe('2026-11-23') // 일요일 기준
      expect(parse('수요일 회의')).toMatchObject({ title: '회의', date: '2026-11-25' })
      expect(parse('금 회의').date).toBe('2026-11-27')
      expect(parse('일요일 회의').date).toBe('2026-11-22') // 오늘이 일요일이면 오늘
      expect(parse('일 회의')).toMatchObject({ title: '일 회의', date: null }) // 한 글자 '일' 혼자는 날짜가 아니다
      expect(parse('월 회의', MONDAY).date).toBe('2026-11-23') // 오늘이 월요일이면 오늘
      expect(parse('일요일 회의', MONDAY).date).toBe('2026-11-29')
    })

    it('다음주 + weekday is that weekday of next week (weeks start on Monday)', () => {
      expect(parse('다음주 월 회의')).toMatchObject({ title: '회의', date: '2026-11-23' }) // 오늘이 일요일
      expect(parse('다음주 월요일 회의', MONDAY).date).toBe('2026-11-30')
      expect(parse('다음주 수 회의', MONDAY).date).toBe('2026-12-02')
      expect(parse('다음주 일 회의', MONDAY).date).toBe('2026-12-06')
      expect(parse('다음주 일요일 회의').date).toBe('2026-11-29')
    })

    it('다음주 without a weekday is not recognized', () => {
      expect(parse('다음주 회의')).toMatchObject({ title: '다음주 회의', date: null })
    })

    it('month/day: this year if it has not passed, otherwise next year', () => {
      expect(parse('11/25 회의')).toMatchObject({ title: '회의', date: '2026-11-25' })
      expect(parse('11/22 회의').date).toBe('2026-11-22') // 오늘
      expect(parse('11/21 회의').date).toBe('2027-11-21') // 지남
      expect(parse('11월 25일 회의')).toMatchObject({ title: '회의', date: '2026-11-25' })
      expect(parse('3월 1일 회의').date).toBe('2027-03-01')
      expect(parse('11월25일 회의').date).toBe('2026-11-25')
    })

    it('Feb 29 moves to the next leap year, and impossible dates are ignored', () => {
      expect(parse('2/29 회의').date).toBe('2028-02-29')
      expect(parse('2/30 회의')).toMatchObject({ title: '2/30 회의', date: null })
      expect(parse('13/5 회의')).toMatchObject({ title: '13/5 회의', date: null })
      expect(parse('0/5 회의').date).toBeNull()
    })

    it('full ISO date', () => {
      expect(parse('2026-12-01 회의')).toMatchObject({ title: '회의', date: '2026-12-01' })
      expect(parse('2026-02-30 회의')).toMatchObject({ title: '2026-02-30 회의', date: null })
    })

    it('crosses the year end', () => {
      expect(parse('내일 회의', '2026-12-31').date).toBe('2027-01-01')
      expect(parse('모레 회의', '2026-12-31').date).toBe('2027-01-02')
      expect(parse('1/2 회의', '2026-12-31').date).toBe('2027-01-02')
    })
  })

  describe('times', () => {
    it('24-hour clock', () => {
      expect(parse('15:30 회의')).toMatchObject({ title: '회의', time: '15:30' })
      expect(parse('9:05 회의').time).toBe('09:05')
      expect(parse('25:00 회의')).toMatchObject({ title: '25:00 회의', time: null })
      expect(parse('12:60 회의').time).toBeNull()
    })

    it('N시 / N시 M분 / N시반', () => {
      expect(parse('3시 회의').time).toBe('15:00')
      expect(parse('3시 30분 회의')).toMatchObject({ title: '회의', time: '15:30' })
      expect(parse('3시30분 회의').time).toBe('15:30')
      expect(parse('3시반 회의').time).toBe('15:30')
      expect(parse('10시 15분 회의').time).toBe('10:15')
    })

    it('without 오전/오후, 1-6시 are afternoon and the rest are as written', () => {
      expect(parse('1시').time).toBe('13:00')
      expect(parse('6시').time).toBe('18:00')
      expect(parse('7시').time).toBe('07:00')
      expect(parse('9시').time).toBe('09:00')
      expect(parse('11시').time).toBe('11:00')
      expect(parse('12시').time).toBe('12:00')
      expect(parse('18시').time).toBe('18:00')
      expect(parse('0시').time).toBe('00:00')
      expect(parse('24시 회의')).toMatchObject({ title: '24시 회의', time: null })
    })

    it('오전 / 오후', () => {
      expect(parse('오전 9시 회의')).toMatchObject({ title: '회의', time: '09:00' })
      expect(parse('오후 3시 회의')).toMatchObject({ title: '회의', time: '15:00' })
      expect(parse('오전 3시').time).toBe('03:00')
      expect(parse('오전 12시').time).toBe('00:00')
      expect(parse('오후 12시').time).toBe('12:00')
      expect(parse('오후 3시 30분 회의')).toMatchObject({ title: '회의', time: '15:30' })
      expect(parse('오후 3:30 회의').time).toBe('15:30')
    })

    it('an invalid hour with 오전/오후 leaves both words in the title', () => {
      expect(parse('오후 15시 회의')).toMatchObject({ title: '오후 15시 회의', time: null })
      expect(parse('오전 회의')).toMatchObject({ title: '오전 회의', time: null })
    })

    it('a time without a date means today', () => {
      expect(parse('오후 3시 회의')).toMatchObject({ date: '2026-11-22', bucket: 'scheduled' })
      expect(parse('15:30 회의', MONDAY).date).toBe('2026-11-23')
    })

    it('a time with a date keeps that date', () => {
      expect(parse('내일 15:30 회의')).toMatchObject({ date: '2026-11-23', time: '15:30' })
    })
  })

  describe('project and priority', () => {
    it('#project', () => {
      expect(parse('#업무 보고서')).toMatchObject({ title: '보고서', project: '업무', bucket: 'inbox' })
    })

    it('ignores an empty #, and only the first project counts', () => {
      expect(parse('# 보고서')).toMatchObject({ title: '# 보고서', project: null })
      expect(parse('#a #b 보고서')).toMatchObject({ title: '#b 보고서', project: 'a' })
    })

    it('!높음 / !중간 / !낮음', () => {
      expect(parse('보고서 !높음')).toMatchObject({ title: '보고서', priority: 3 })
      expect(parse('보고서 !중간').priority).toBe(2)
      expect(parse('보고서 !낮음').priority).toBe(1)
    })

    it('!3 / !2 / !1', () => {
      expect(parse('!3 보고서').priority).toBe(3)
      expect(parse('!2 보고서').priority).toBe(2)
      expect(parse('!1 보고서').priority).toBe(1)
    })

    it('other ! words are not priorities, and only the first priority counts', () => {
      expect(parse('!5 보고서')).toMatchObject({ title: '!5 보고서', priority: 0 })
      expect(parse('!긴급 보고서')).toMatchObject({ title: '!긴급 보고서', priority: 0 })
      expect(parse('!높음 !낮음 보고서')).toMatchObject({ title: '!낮음 보고서', priority: 3 })
    })
  })

  describe('repeat', () => {
    it('매일', () => {
      expect(parse('매일 운동')).toEqual({
        title: '운동',
        date: '2026-11-22', // 오늘 포함 첫 해당일
        time: null,
        project: null,
        priority: 0,
        repeat: { freq: 'daily', interval: 1, anchor: '2026-11-22' }, // 새 반복의 기준일은 그 할 일의 날짜
        bucket: 'scheduled',
        dateFrom: null
      })
    })

    it('매주 + weekdays', () => {
      expect(parse('매주 월 회의')).toMatchObject({
        title: '회의',
        date: '2026-11-23',
        repeat: { freq: 'weekly', interval: 1, byWeekday: [1] }
      })
      expect(parse('매주 월 수 금 운동')).toMatchObject({
        title: '운동',
        date: '2026-11-23',
        repeat: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }
      })
      expect(parse('매주 금요일 보고')).toMatchObject({
        date: '2026-11-27',
        repeat: { freq: 'weekly', interval: 1, byWeekday: [5] }
      })
    })

    it('매주 on a matching weekday starts today', () => {
      expect(parse('매주 일 정리').date).toBe('2026-11-22')
    })

    it('매주 without a weekday', () => {
      expect(parse('매주 청소')).toMatchObject({
        title: '청소',
        date: '2026-11-22',
        repeat: { freq: 'weekly', interval: 1 }
      })
    })

    it('평일', () => {
      expect(parse('평일 출근')).toMatchObject({
        title: '출근',
        date: '2026-11-23',
        repeat: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }
      })
    })

    it('매월 15일', () => {
      expect(parse('매월 15일 청구서')).toMatchObject({
        title: '청구서',
        date: '2026-12-15', // 이번 달 15일은 지났다
        repeat: { freq: 'monthly', interval: 1, byMonthDay: 15 }
      })
      expect(parse('매월 25일 청구서').date).toBe('2026-11-25')
    })

    it('매월 without a day uses the day of the decided date', () => {
      expect(parse('매월 청구서')).toMatchObject({
        title: '청구서',
        date: '2026-11-22',
        repeat: { freq: 'monthly', interval: 1, byMonthDay: 22 }
      })
      expect(parse('내일 매월 청구서')).toMatchObject({
        date: '2026-11-23',
        repeat: { freq: 'monthly', interval: 1, byMonthDay: 23 }
      })
      expect(parse('1/31 매월 청구서').repeat).toEqual({ freq: 'monthly', interval: 1, byMonthDay: 31, anchor: '2027-01-31' })
    })

    it('매월 with an invalid day: the day stays in the title', () => {
      expect(parse('매월 32일 청구서')).toMatchObject({
        title: '32일 청구서',
        repeat: { freq: 'monthly', interval: 1, byMonthDay: 22 }
      })
    })

    it('매년', () => {
      expect(parse('매년 생일')).toMatchObject({
        title: '생일',
        date: '2026-11-22',
        repeat: { freq: 'yearly', interval: 1 }
      })
    })

    it('매년 fills the month and day from the date, and every new repeat gets the date as its anchor', () => {
      expect(parse('매년 생일').repeat).toEqual({ freq: 'yearly', interval: 1, byMonth: 11, byMonthDay: 22, anchor: '2026-11-22' })
      expect(parse('12/25 매년 기념일').repeat).toEqual({ freq: 'yearly', interval: 1, byMonth: 12, byMonthDay: 25, anchor: '2026-12-25' })
      expect(parse('매일 운동').repeat?.anchor).toBe(parse('매일 운동').date)
      expect(parse('매주 월 12/7 회의').repeat).toMatchObject({ freq: 'weekly', byWeekday: [1], anchor: '2026-12-07' })
      expect(parse('운동').repeat).toBeNull() // 반복이 없으면 기준일도 없다
    })

    it('an explicit date wins over the first occurrence', () => {
      expect(parse('내일 매일 운동')).toMatchObject({ date: '2026-11-23', repeat: { freq: 'daily', interval: 1 } })
      expect(parse('매주 월 12/7 회의').date).toBe('2026-12-07')
    })

    it('a repeating result passes task validation', () => {
      const parsed = parse('매주 월 수 금 오후 3시 운동 #건강 !중간')

      const issues = validateTaskFields({
        ...parsed,
        notes: '',
        deadline: null,
        tags: [],
        routineId: null,
        source: null
      })
      expect(issues).toEqual([])
    })
  })

  describe('combinations', () => {
    it('내일 오후 3시 보고서 #업무 !높음', () => {
      expect(parse('내일 오후 3시 보고서 #업무 !높음')).toEqual({
        title: '보고서',
        date: '2026-11-23',
        time: '15:00',
        project: '업무',
        priority: 3,
        repeat: null,
        bucket: 'scheduled',
        dateFrom: 'text'
      })
    })

    it('works in any order', () => {
      expect(parse('!높음 #업무 보고서 오후 3시 내일')).toEqual(parse('내일 오후 3시 보고서 #업무 !높음'))
    })

    it('매주 월 + time + project', () => {
      expect(parse('매주 월 오전 9시 주간회의 #팀')).toEqual({
        title: '주간회의',
        date: '2026-11-23',
        time: '09:00',
        project: '팀',
        priority: 0,
        repeat: { freq: 'weekly', interval: 1, byWeekday: [1], anchor: '2026-11-23' },
        bucket: 'scheduled',
        dateFrom: null
      })
    })
  })

  describe('when the title would be empty', () => {
    it('uses the original text and still applies the date', () => {
      expect(parse('내일')).toMatchObject({ title: '내일', date: '2026-11-23', bucket: 'scheduled' })
      expect(parse('다음주 월 오후 3시')).toMatchObject({ title: '다음주 월 오후 3시', date: '2026-11-23', time: '15:00' })
    })

    it('uses the original text for project/priority only input', () => {
      expect(parse('#업무 !높음')).toMatchObject({ title: '#업무 !높음', project: '업무', priority: 3 })
    })
  })

  describe('the same kind twice', () => {
    it('keeps the first and leaves the second in the title', () => {
      expect(parse('내일 모레 회의')).toMatchObject({ title: '모레 회의', date: '2026-11-23' })
      expect(parse('내일 다음주 월 회의')).toMatchObject({ title: '다음주 월 회의', date: '2026-11-23' })
      expect(parse('3시 5시 회의')).toMatchObject({ title: '5시 회의', time: '15:00' })
      expect(parse('오전 9시 오후 3시 회의')).toMatchObject({ title: '오후 3시 회의', time: '09:00' })
      expect(parse('매일 매주 월 운동')).toMatchObject({
        title: '매주 월 운동',
        repeat: { freq: 'daily', interval: 1 }
      })
    })
  })
})

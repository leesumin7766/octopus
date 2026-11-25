import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { firstOccurrence, nextOccurrence, nextOccurrenceFrom, withAnchor } from '../../src/shared/tasks/repeat'
import type { RepeatRule } from '../../src/shared/tasks/types'
import { repeatRuleProblem, validateTaskFields } from '../../src/shared/validation/task'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

// 기준일(anchor)과 매년 월·일. 순수 달력 계산이라 시계에 기대지 않는다.

/** rule 로 start 부터 n 번 이어 간 회차들 */
function chain(rule: RepeatRule, start: string, n: number): string[] {
  const dates = [start]
  for (let i = 0; i < n; i++) dates.push(nextOccurrence(rule, dates[dates.length - 1]))
  return dates
}

describe('yearly with a month and a day', () => {
  const leapDay: RepeatRule = { freq: 'yearly', interval: 1, byMonth: 2, byMonthDay: 29 }

  it('2/29 goes to 2/28 in a common year and comes back to 2/29 in the next leap year (2028 → 2029 → 2030 → 2031 → 2032)', () => {
    expect(chain(leapDay, '2028-02-29', 4)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  })

  it('an ordinary month-day repeats every year, also when the previous occurrence was moved', () => {
    const rule: RepeatRule = { freq: 'yearly', interval: 1, byMonth: 11, byMonthDay: 22 }
    expect(chain(rule, '2026-11-22', 2)).toEqual(['2026-11-22', '2027-11-22', '2028-11-22'])
    expect(nextOccurrence(rule, '2026-12-30')).toBe('2027-11-22') // 늦게 끝냈거나 옮긴 뒤에도 그 월·일
    expect(nextOccurrence(rule, '2026-05-01')).toBe('2026-11-22') // 같은 해의 아직 안 온 날
  })

  it('every two years from the anchor year', () => {
    const rule: RepeatRule = { freq: 'yearly', interval: 2, byMonth: 3, byMonthDay: 10, anchor: '2026-03-10' }
    expect(chain(rule, '2026-03-10', 3)).toEqual(['2026-03-10', '2028-03-10', '2030-03-10', '2032-03-10'])
    expect(nextOccurrence(rule, '2027-06-01')).toBe('2028-03-10') // 날짜가 어디로 옮겨져도 홀수 해로 어긋나지 않는다
  })

  it('without an anchor, an interval counts from the previous occurrence like before', () => {
    expect(nextOccurrence({ freq: 'yearly', interval: 2, byMonth: 3, byMonthDay: 10 }, '2027-06-01')).toBe('2029-03-10')
  })

  it('a rule without month and day behaves as it always did (an old yearly rule)', () => {
    expect(nextOccurrence({ freq: 'yearly', interval: 1 }, '2026-11-22')).toBe('2027-11-22')
    expect(chain({ freq: 'yearly', interval: 1 }, '2028-02-29', 2)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']) // 옛 규칙은 2/29 로 돌아오지 못한다
  })

  it('the first occurrence of a new yearly repeat is the coming month-day (today counts)', () => {
    const rule: RepeatRule = { freq: 'yearly', interval: 1, byMonth: 12, byMonthDay: 25 }
    expect(firstOccurrence(rule, '2026-11-22')).toBe('2026-12-25')
    expect(firstOccurrence(rule, '2026-12-25')).toBe('2026-12-25')
    expect(firstOccurrence(rule, '2026-12-26')).toBe('2027-12-25')
    expect(firstOccurrence(leapDay, '2027-03-01')).toBe('2028-02-29')
  })
})

describe('an interval counted from the anchor', () => {
  it('every two weeks: finishing three weeks late keeps the original cycle', () => {
    const rule: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-03-02' } // 월요일 시작
    // 3/2 의 일을 3/23 에 끝냈다: 3/16 은 지났고 다음은 원래 주기의 3/30
    expect(nextOccurrenceFrom(rule, '2026-03-02', '2026-03-23')).toBe('2026-03-30')
    expect(chain(rule, '2026-03-02', 3)).toEqual(['2026-03-02', '2026-03-16', '2026-03-30', '2026-04-13'])
  })

  it('every two weeks: moving the task date does not shift the cycle (the old rule would)', () => {
    const anchored: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-03-02' }
    const legacy: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1] }
    // 격주 월요일 일을 화요일(3/10)로 옮겨 놓고 끝냈다
    expect(nextOccurrence(anchored, '2026-03-10')).toBe('2026-03-16') // 원래 주기(3/2, 3/16, …)
    expect(nextOccurrence(legacy, '2026-03-10')).toBe('2026-03-23') // 기준일이 없으면 직전 회차에서 센다(어긋남)
  })

  it('several weekdays in the same on-cycle week, then skip the off week', () => {
    const rule: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1, 3], anchor: '2026-03-02' }
    expect(chain(rule, '2026-03-02', 4)).toEqual(['2026-03-02', '2026-03-04', '2026-03-16', '2026-03-18', '2026-03-30'])
  })

  it('weekdays before the anchor day in the first week are not occurrences', () => {
    const rule: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1, 3], anchor: '2026-03-04' } // 수요일 시작
    expect(nextOccurrence(rule, '2026-03-01')).toBe('2026-03-04') // 월요일(3/2)은 기준일 이전이라 건너뜀
    expect(nextOccurrence(rule, '2026-03-04')).toBe('2026-03-16')
  })

  it('every three days from the anchor, wherever the date was moved', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 3, anchor: '2026-03-01' }
    expect(chain(rule, '2026-03-01', 3)).toEqual(['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10'])
    expect(nextOccurrence(rule, '2026-03-05')).toBe('2026-03-07') // 3/5 로 옮겨도 3/1 + 3 의 배수
    expect(nextOccurrence(rule, '2026-02-20')).toBe('2026-03-01') // 기준일 전이면 기준일부터
  })

  it('monthly on the 31st: short months use their last day and the day comes back', () => {
    const everyMonth: RepeatRule = { freq: 'monthly', interval: 1, byMonthDay: 31 }
    expect(chain(everyMonth, '2026-01-31', 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    const everyTwo: RepeatRule = { freq: 'monthly', interval: 2, byMonthDay: 31, anchor: '2026-01-31' }
    expect(chain(everyTwo, '2026-01-31', 3)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'])
  })

  it('every two months from the anchor month, wherever the date was moved', () => {
    const rule: RepeatRule = { freq: 'monthly', interval: 2, byMonthDay: 15, anchor: '2026-01-15' }
    expect(nextOccurrence(rule, '2026-02-20')).toBe('2026-03-15') // 2월로 옮겨 끝내도 홀수 달(1·3·5…)을 지킨다
    expect(nextOccurrence({ ...rule, anchor: undefined }, '2026-02-20')).toBe('2026-04-15') // 기준일이 없으면 어긋남
  })

  it('a monthly rule without a day uses the anchor day', () => {
    const rule: RepeatRule = { freq: 'monthly', interval: 2, anchor: '2026-01-30' }
    expect(chain(rule, '2026-01-30', 3)).toEqual(['2026-01-30', '2026-03-30', '2026-05-30', '2026-07-30'])
  })

  it('with interval 1 the anchor changes nothing', () => {
    expect(nextOccurrence({ freq: 'daily', interval: 1, anchor: '2020-01-01' }, '2026-03-10')).toBe('2026-03-11')
    expect(nextOccurrence({ freq: 'weekly', interval: 1, byWeekday: [1], anchor: '2020-01-01' }, '2026-03-10')).toBe('2026-03-16')
  })

  it('an old repeat without an anchor keeps its exact old behaviour for every kind', () => {
    expect(nextOccurrence({ freq: 'daily', interval: 3 }, '2026-03-10')).toBe('2026-03-13')
    expect(nextOccurrence({ freq: 'weekly', interval: 2, byWeekday: [1] }, '2026-03-10')).toBe('2026-03-23')
    expect(nextOccurrence({ freq: 'monthly', interval: 2, byMonthDay: 15 }, '2026-03-20')).toBe('2026-05-15')
    expect(nextOccurrence({ freq: 'monthly', interval: 1, byMonthDay: 31 }, '2026-02-28')).toBe('2026-03-31')
  })
})

describe('withAnchor (what the parser and the editor use for a new repeat)', () => {
  it('sets the anchor to the task date, and fills month and day for yearly (existing values stay)', () => {
    expect(withAnchor({ freq: 'daily', interval: 2 }, '2026-03-10')).toEqual({ freq: 'daily', interval: 2, anchor: '2026-03-10' })
    expect(withAnchor({ freq: 'yearly', interval: 1 }, '2026-03-10')).toEqual({ freq: 'yearly', interval: 1, byMonth: 3, byMonthDay: 10, anchor: '2026-03-10' })
    expect(withAnchor({ freq: 'yearly', interval: 1, byMonth: 2, byMonthDay: 29 }, '2028-03-01')).toMatchObject({ byMonth: 2, byMonthDay: 29, anchor: '2028-03-01' })
    expect(withAnchor({ freq: 'weekly', interval: 1, byWeekday: [1] }, '2026-03-10')).not.toHaveProperty('byMonth')
  })

  it('does not change the rule it was given', () => {
    const rule: RepeatRule = { freq: 'yearly', interval: 1 }
    withAnchor(rule, '2026-03-10')
    expect(rule).toEqual({ freq: 'yearly', interval: 1 })
  })
})

describe('validation of the new fields', () => {
  it('accepts an anchor and a yearly month-day, and still accepts every old rule', () => {
    for (const rule of [
      { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-03-02' },
      { freq: 'yearly', interval: 1, byMonth: 2, byMonthDay: 29, anchor: '2028-02-29' },
      { freq: 'yearly', interval: 1, byMonth: 12, byMonthDay: 31 },
      { freq: 'daily', interval: 1 },
      { freq: 'weekly', interval: 1 },
      { freq: 'monthly', interval: 1, byMonthDay: 15 },
      { freq: 'yearly', interval: 1 },
      { freq: 'yearly', interval: 1, byMonthDay: 5 }, // 월 없이 일만 있던 옛 규칙도 받는다
      null
    ]) {
      expect(repeatRuleProblem(rule), JSON.stringify(rule)).toBeNull()
    }
  })

  it('rejects a wrong anchor or month', () => {
    const wrong: unknown[] = [
      { freq: 'daily', interval: 2, anchor: '2026-02-30' },
      { freq: 'daily', interval: 2, anchor: '내일' },
      { freq: 'daily', interval: 2, anchor: 20260302 },
      { freq: 'daily', interval: 2, anchor: '2026-3-2' },
      { freq: 'yearly', interval: 1, byMonth: 0, byMonthDay: 1 },
      { freq: 'yearly', interval: 1, byMonth: 13, byMonthDay: 1 },
      { freq: 'yearly', interval: 1, byMonth: 1.5, byMonthDay: 1 },
      { freq: 'yearly', interval: 1, byMonth: '3', byMonthDay: 1 },
      { freq: 'yearly', interval: 1, byMonth: 3 }, // 일 없이 월만
      { freq: 'monthly', interval: 1, byMonth: 3, byMonthDay: 1 } // 월은 매년에만
    ]
    for (const rule of wrong) expect(repeatRuleProblem(rule), JSON.stringify(rule)).not.toBeNull()
  })

  it('a task with an anchored repeat passes the task validation (and a wrong one is reported on "repeat")', () => {
    const base = { title: 't', notes: '', bucket: 'scheduled', date: '2026-03-10', time: null, deadline: null, priority: 0, project: null, tags: [], routineId: null, source: null } as const
    expect(validateTaskFields({ ...base, repeat: { freq: 'weekly', interval: 2, byWeekday: [2], anchor: '2026-03-10' } })).toEqual([])
    expect(validateTaskFields({ ...base, repeat: { freq: 'weekly', interval: 2, anchor: 'x' } }).map((i) => i.field)).toEqual(['repeat'])
  })

  it('the calculation refuses a wrong rule instead of guessing', () => {
    expect(() => nextOccurrence({ freq: 'daily', interval: 2, anchor: '2026-02-30' }, '2026-03-10')).toThrow(RangeError)
  })
})

describe('stored data (JSON in the database)', () => {
  let t: TestRepo

  beforeEach(() => {
    t = createTestRepo()
  })

  afterEach(() => {
    t.db.close()
  })

  /** 옛 앱이 저장했을 JSON(기준일·월 없음)을 그대로 넣는다 */
  function insertOld(title: string, date: string, repeat: string): string {
    const id = '01ARZ3NDEKTSV4RRFFQ69G5F10'
    t.db
      .prepare(
        `INSERT INTO tasks (id, title, notes, status, bucket, date, priority, tags, repeat, sort_order, created_at, updated_at)
         VALUES (?, ?, '', 'open', 'scheduled', ?, 0, '[]', ?, 1, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')`
      )
      .run(id, title, date, repeat)
    return id
  }

  it('reads an old repeat as it is (no anchor appears) and completing it makes the next occurrence the old way', () => {
    const id = insertOld('옛 격주', '2026-03-09', JSON.stringify({ freq: 'weekly', interval: 2, byWeekday: [1] }))
    expect(t.repo.get(id)?.repeat).toEqual({ freq: 'weekly', interval: 2, byWeekday: [1] })

    t.setNow(new Date(2026, 2, 10, 12, 0, 0).toISOString())
    t.repo.setStatus(id, 'done')

    const next = t.repo.listView('upcoming', '2026-03-10')[0]
    expect(next.date).toBe('2026-03-23')
    expect(next.repeat).toEqual({ freq: 'weekly', interval: 2, byWeekday: [1] }) // 옛 규칙 그대로 복사
  })

  it('an old yearly rule (no month/day) works, and may be saved again unchanged', () => {
    const id = insertOld('옛 매년', '2026-03-10', JSON.stringify({ freq: 'yearly', interval: 1 }))

    t.setNow(new Date(2026, 2, 10, 12, 0, 0).toISOString())
    t.repo.setStatus(id, 'done')

    expect(t.repo.listView('upcoming', '2026-03-10')[0]).toMatchObject({ date: '2027-03-10', repeat: { freq: 'yearly', interval: 1 } })
  })

  it('completing a task with an anchored rule copies anchor and month-day to the next occurrence untouched', () => {
    const rule: RepeatRule = { freq: 'yearly', interval: 1, byMonth: 2, byMonthDay: 29, anchor: '2028-02-29' }
    const task = t.repo.create({ title: '윤일', date: '2028-02-29', repeat: rule })

    t.setNow(new Date(2028, 1, 29, 12, 0, 0).toISOString())
    t.repo.setStatus(task.id, 'done')

    const next = t.repo.listView('upcoming', '2028-02-29')[0]
    expect(next.date).toBe('2029-02-28')
    expect(next.repeat).toEqual(rule)
  })

  it('a biweekly task finished three weeks late creates the next one on the original cycle', () => {
    const rule: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-03-02' }
    const task = t.repo.create({ title: '격주 회의', date: '2026-03-02', repeat: rule })

    t.setNow(new Date(2026, 2, 23, 12, 0, 0).toISOString()) // 3주 늦게
    t.repo.setStatus(task.id, 'done')

    expect(t.repo.listView('today', '2026-03-23').overdue).toEqual([])
    expect(t.repo.listView('upcoming', '2026-03-23')[0]).toMatchObject({ date: '2026-03-30', repeat: rule })
  })

  it('undoing the completion removes the untouched next occurrence also for an anchored rule', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 3, anchor: '2026-03-10' }
    const task = t.repo.create({ title: '사흘마다', date: '2026-03-10', repeat: rule })
    t.setNow(new Date(2026, 2, 10, 12, 0, 0).toISOString())
    t.repo.setStatus(task.id, 'done')
    expect(t.repo.listView('upcoming', '2026-03-10')).toHaveLength(1)

    t.repo.setStatus(task.id, 'open')

    expect(t.repo.listView('upcoming', '2026-03-10')).toHaveLength(0)
  })

  it('refuses to save a wrong anchor', () => {
    expect(() => t.repo.create({ title: 'x', date: '2026-03-10', repeat: { freq: 'daily', interval: 2, anchor: '2026-13-01' } })).toThrow()
  })
})

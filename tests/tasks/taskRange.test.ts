import { afterEach, describe, expect, it } from 'vitest'
import { TaskValidationError } from '../../src/shared/validation/task'
import { createTestRepo, type TestRepo } from './helpers'

// C1-01~03, C1-06, C1-07, C1-10, C1-13: 날짜 구간 조회(저장소). 조회만 하고 아무 것도 만들지 않는다.
// 기준 날짜 T = 2026-03-10. 로컬 날짜 문자열만 쓰므로 시간대와 무관하다.

const T = '2026-03-10'

/** 검사에 걸린 필드 이름(검사를 통과하면 undefined) */
function fieldRejected(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    if (error instanceof TaskValidationError) return error.issues[0]?.field
    throw error
  }
}

describe('task repository: listRange', () => {
  let t: TestRepo | undefined

  afterEach(() => {
    t?.db.close()
    t = undefined
  })

  /** 기준 데이터(C1 샘플): A 09:00 / B 시간 없음 / I 반복 / C T+1 14:00 / D 지난 미완료 / E 예정 T-1 완료 시각 T / F 수신함 / G 나중 / H 취소 */
  function seed(): TestRepo {
    t = createTestRepo('2026-03-10T03:00:00.000Z')
    const repo = t.repo
    repo.create({ title: 'A 아침', date: T, time: '09:00' })
    repo.create({ title: 'B 시간없음', date: T })
    repo.create({ title: 'I 반복', date: T, repeat: { freq: 'daily', interval: 1 } })
    repo.create({ title: 'C 내일', date: '2026-03-11', time: '14:00' })
    repo.create({ title: 'D 지난', date: '2026-03-09' })
    const e = repo.create({ title: 'E 어제 한 일', date: '2026-03-09' })
    t.setNow('2026-03-10T03:00:00.000Z')
    repo.setStatus(e.id, 'done')
    repo.create({ title: 'F 수신함' })
    repo.create({ title: 'G 나중', bucket: 'someday' })
    const h = repo.create({ title: 'H 취소', date: T })
    repo.setStatus(h.id, 'canceled')
    return t
  }

  const titles = (repo: TestRepo['repo'], from: string, to: string): string[] => repo.listRange(from, to).map((x) => x.title)

  it('a day returns that day\'s open and completed items, timed first in time order, untimed after', () => {
    const { repo } = seed()
    // A(09:00) → B·I(시간 없음, 만든 순서) 순. 날짜 없는 F·G, 취소된 H, 다른 날짜는 빠진다.
    expect(titles(repo, T, T)).toEqual(['A 아침', 'B 시간없음', 'I 반복'])
  })

  it('a completed item stays on its scheduled day (doneAt is not used as the date)', () => {
    const { repo } = seed()
    expect(titles(repo, '2026-03-09', '2026-03-09')).toEqual(['D 지난', 'E 어제 한 일'])
    expect(titles(repo, T, T)).not.toContain('E 어제 한 일')
    const e = repo.listRange('2026-03-09', '2026-03-09').find((x) => x.title === 'E 어제 한 일')
    expect(e?.status).toBe('done')
    expect(e?.date).toBe('2026-03-09')
  })

  it('the next day returns only its own items', () => {
    const { repo } = seed()
    expect(titles(repo, '2026-03-11', '2026-03-11')).toEqual(['C 내일'])
  })

  it('a range returns items ordered by date, then time', () => {
    const { repo } = seed()
    expect(titles(repo, '2026-03-09', '2026-03-11')).toEqual(['D 지난', 'E 어제 한 일', 'A 아침', 'B 시간없음', 'I 반복', 'C 내일'])
  })

  it('an empty day or empty month returns an empty list, not an error', () => {
    const { repo } = seed()
    expect(repo.listRange('2026-04-01', '2026-04-01')).toEqual([])
    expect(repo.listRange('2026-04-01', '2026-04-30')).toEqual([])
  })

  it('a range across the year end and a leap day both work', () => {
    t = createTestRepo('2026-12-01T03:00:00.000Z')
    const repo = t.repo
    repo.create({ title: '연말', date: '2026-12-31' })
    repo.create({ title: '새해', date: '2027-01-01' })
    repo.create({ title: '윤년 하루', date: '2028-02-29' })
    expect(titles(repo, '2026-12-31', '2027-01-01')).toEqual(['연말', '새해'])
    expect(titles(repo, '2028-02-01', '2028-02-29')).toEqual(['윤년 하루'])
  })

  it('a range of exactly 62 days is allowed; 63 days is rejected', () => {
    const { repo } = seed()
    expect(repo.listRange('2026-01-01', '2026-03-03')).toEqual([])
    expect(() => repo.listRange('2026-01-01', '2026-03-04')).toThrow(TaskValidationError)
  })

  it('a non-existent date or a reversed range is rejected with the field name', () => {
    const { repo } = seed()
    expect(fieldRejected(() => repo.listRange('2026-02-30', '2026-03-01'))).toBe('from')
    expect(fieldRejected(() => repo.listRange(T, '2026-03-09'))).toBe('to')
    expect(fieldRejected(() => repo.listRange('2026-01-01', '2026-03-04'))).toBe('to')
  })

  it('reading a range never creates, changes or deletes any row', () => {
    const { repo, db } = seed()
    const count = (): number => (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n
    const before = count()
    const snapshot = JSON.stringify(repo.listRange('2026-03-01', '2026-03-31'))
    repo.listRange('2026-04-01', '2026-04-30')
    expect(count()).toBe(before)
    expect(JSON.stringify(repo.listRange('2026-03-01', '2026-03-31'))).toBe(snapshot)
  })
})

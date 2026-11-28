import { afterEach, describe, expect, it } from 'vitest'
import { parseQuickInput } from '../../src/shared/tasks/quickParse'
import { createTestRepo, type TestRepo } from './helpers'

// 말로 입력한 반복(R1)을 저장하고 끝내면, 다음 회차가 주기대로 하나만 생긴다.
let t: TestRepo
afterEach(() => t?.db.close())

/** listRange 는 한 번에 62일까지라 구간을 나눠 읽는다. */
function allTasks() {
  const out = [] as ReturnType<TestRepo['repo']['listRange']>
  for (let day = new Date('2026-01-01T00:00:00Z'); day < new Date('2028-12-31T00:00:00Z'); day = new Date(day.getTime() + 60 * 86_400_000)) {
    const to = new Date(day.getTime() + 59 * 86_400_000)
    out.push(...t.repo.listRange(day.toISOString().slice(0, 10), to.toISOString().slice(0, 10)))
  }
  return out
}

function addFrom(text: string, today: string) {
  t = createTestRepo(`${today}T09:00:00.000Z`)
  const p = parseQuickInput(text, today)
  return t.repo.create({ title: p.title, date: p.date, time: p.time, repeat: p.repeat, bucket: p.bucket })
}

function nextAfterDone(text: string, today: string): { first: string | null; next: string | null; openCopies: number } {
  const task = addFrom(text, today)
  t.repo.setStatus(task.id, 'done')
  const open = allTasks().filter((x) => x.title === task.title && x.status === 'open')
  return { first: task.date, next: open[0]?.date ?? null, openCopies: open.length }
}

describe('completing a spoken repeat makes the next occurrence on the cycle', () => {
  it('격주 월: Monday 11/23 → 12/07', () => {
    expect(nextAfterDone('격주 월 회의', '2026-11-22')).toEqual({ first: '2026-11-23', next: '2026-12-07', openCopies: 1 })
  })

  it('3주마다 월 수: 11/23(월) → 11/25(수) → …', () => {
    const task = addFrom('3주마다 월 수 회의', '2026-11-22')
    expect(task.date).toBe('2026-11-23')
    t.repo.setStatus(task.id, 'done')
    const second = allTasks().find((x) => x.title === '회의' && x.status === 'open')!
    expect(second.date).toBe('2026-11-25')
    t.repo.setStatus(second.id, 'done')
    const third = allTasks().find((x) => x.title === '회의' && x.status === 'open')!
    expect(third.date).toBe('2026-12-14') // 3주 뒤 주의 월요일
  })

  it('2주마다 평일: Friday → next Monday of the 2nd week', () => {
    const r = nextAfterDone('2주마다 평일 점검', '2026-11-27') // 금요일
    expect(r.first).toBe('2026-11-27')
    expect(r.openCopies).toBe(1)
    expect(r.next).toBe('2026-12-07') // 2주 뒤 주의 월요일
  })

  it('3일마다: 11/22 → 11/25', () => {
    expect(nextAfterDone('3일마다 물주기', '2026-11-22')).toEqual({ first: '2026-11-22', next: '2026-11-25', openCopies: 1 })
  })

  it('2개월마다: 11/22 → 2027-01-22', () => {
    expect(nextAfterDone('2개월마다 점검', '2026-11-22')).toEqual({ first: '2026-11-22', next: '2027-01-22', openCopies: 1 })
  })

  it('2개월마다 on the 31st: short months clamp to the last day', () => {
    const task = addFrom('2026-12-31 2개월마다 정산', '2026-11-22')
    t.repo.setStatus(task.id, 'done')
    const next = allTasks().find((x) => x.status === 'open')!
    expect(next.date).toBe('2027-02-28')
  })
})

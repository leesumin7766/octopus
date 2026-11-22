import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskValidationError } from '../../src/shared/validation/task'
import type { RepeatRule } from '../../src/shared/tasks/types'
import { createTestRepo, type TestRepo } from './helpers'

const MONDAYS: RepeatRule = { freq: 'weekly', interval: 1, byWeekday: [1] }
const DAILY: RepeatRule = { freq: 'daily', interval: 1 }

/** 로컬 시각 기준 정오. 어느 시간대에서 돌려도 로컬 날짜가 y-m-d 가 된다. */
function localNoon(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString()
}

describe('completing a repeating task', () => {
  let t: TestRepo

  beforeEach(() => {
    t = createTestRepo()
  })

  afterEach(() => {
    t.db.close()
  })

  function count(): number {
    return (t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n
  }

  it('creates the next occurrence as a new open task with the other fields copied', () => {
    const original = t.repo.create({
      title: '주간 보고',
      notes: '# 양식 확인',
      date: '2026-03-09', // 월요일
      time: '10:00',
      deadline: '2026-03-20',
      priority: 2,
      project: '업무',
      tags: ['보고', '주간'],
      repeat: MONDAYS,
      routineId: 'routine-1',
      source: { arm: 'google-calendar', ref: 'evt-1', url: 'https://example.com/evt-1' }
    })
    t.setNow(localNoon(2026, 3, 10))

    const done = t.repo.setStatus(original.id, 'done')

    expect(done).toMatchObject({ id: original.id, status: 'done', date: '2026-03-09' })
    expect(done.doneAt).not.toBeNull()
    expect(count()).toBe(2)

    const [next] = t.repo.listView('upcoming', '2026-03-10')
    expect(next.id).not.toBe(original.id)
    expect(next).toMatchObject({
      title: '주간 보고',
      notes: '# 양식 확인',
      status: 'open',
      bucket: 'scheduled',
      date: '2026-03-16',
      time: '10:00',
      deadline: '2026-03-20',
      priority: 2,
      project: '업무',
      tags: ['보고', '주간'],
      repeat: MONDAYS,
      routineId: 'routine-1',
      source: { arm: 'google-calendar', ref: 'evt-1', url: 'https://example.com/evt-1' },
      doneAt: null,
      createdAt: t.repo.get(original.id)?.doneAt
    })
    expect(next.order).toBeGreaterThan(original.order)
  })

  it('a long-overdue repeating task jumps to the first occurrence after today', () => {
    // 월요일 반복, 1월 5일부터 밀림. 3/10(화) 에 끝내면 3/9 은 이미 지났으니 3/16.
    const original = t.repo.create({ title: '밀린 일', date: '2026-01-05', repeat: MONDAYS })
    t.setNow(localNoon(2026, 3, 10))

    t.repo.setStatus(original.id, 'done')

    expect(t.repo.listView('upcoming', '2026-03-10').map((task) => task.date)).toEqual(['2026-03-16'])
    expect(t.repo.listView('today', '2026-03-10')).toEqual({ overdue: [], today: [] })
  })

  it('the next occurrence can be today itself', () => {
    const original = t.repo.create({ title: '밀린 일', date: '2026-01-05', repeat: MONDAYS })
    t.setNow(localNoon(2026, 3, 9)) // 월요일

    t.repo.setStatus(original.id, 'done')

    expect(t.repo.listView('today', '2026-03-09').today.map((task) => task.date)).toEqual(['2026-03-09'])
  })

  it('daily: finishing today schedules tomorrow', () => {
    const original = t.repo.create({ title: '운동', date: '2026-03-10', repeat: DAILY })
    t.setNow(localNoon(2026, 3, 10))

    t.repo.setStatus(original.id, 'done')

    expect(t.repo.listView('upcoming', '2026-03-10').map((task) => task.date)).toEqual(['2026-03-11'])
  })

  it('uses the local calendar date of now() as today', () => {
    // 로컬 3/9 00:30 (한국 시간대에서는 UTC 로 3/8). 3/1 부터 밀린 매일 반복은 3/9 로 와야 한다.
    const original = t.repo.create({ title: '운동', date: '2026-03-01', repeat: DAILY })
    t.setNow(new Date(2026, 2, 9, 0, 30).toISOString())

    t.repo.setStatus(original.id, 'done')

    expect(t.repo.listView('today', '2026-03-09').today.map((task) => task.date)).toEqual(['2026-03-09'])
  })

  it('does not create anything for a task without a repeat rule', () => {
    const plain = t.repo.create({ title: '한 번만', date: '2026-03-10' })

    t.repo.setStatus(plain.id, 'done')

    expect(count()).toBe(1)
  })

  it('does not create anything when a task is canceled or reopened', () => {
    const original = t.repo.create({ title: '운동', date: '2026-03-10', repeat: DAILY })

    t.repo.setStatus(original.id, 'canceled')
    t.repo.setStatus(original.id, 'open')

    expect(count()).toBe(1)
  })

  it('does not create another one when an already-done task is set to done again', () => {
    const original = t.repo.create({ title: '운동', date: '2026-03-10', repeat: DAILY })
    t.repo.setStatus(original.id, 'done')

    t.repo.setStatus(original.id, 'done')

    expect(count()).toBe(2)
  })

  it('rolls the status change back when the next occurrence cannot be made', () => {
    // 검증을 거치지 않고 잘못된 반복 규칙(interval 0)이 들어간 옛 데이터
    t.db
      .prepare(
        `INSERT INTO tasks (id, title, status, bucket, date, repeat, sort_order, created_at, updated_at)
         VALUES ('01BROKEN', 'broken', 'open', 'scheduled', '2026-03-01', ?, 1, 'x', 'x')`
      )
      .run(JSON.stringify({ freq: 'weekly', interval: 0 }))

    expect(() => t.repo.setStatus('01BROKEN', 'done')).toThrow(RangeError)

    expect(t.repo.get('01BROKEN')).toMatchObject({ status: 'open', doneAt: null, updatedAt: 'x' })
    expect(count()).toBe(1)
  })
})

describe('repeat rules and buckets', () => {
  let t: TestRepo

  beforeEach(() => {
    t = createTestRepo()
  })

  afterEach(() => {
    t.db.close()
  })

  it('a repeating task needs a date', () => {
    expect(() => t.repo.create({ title: '운동', repeat: DAILY })).toThrow(TaskValidationError)
  })

  it('a repeating task cannot be moved to someday by update', () => {
    const task = t.repo.create({ title: '운동', date: '2026-03-10', repeat: DAILY })

    expect(() => t.repo.update(task.id, { bucket: 'someday', date: null })).toThrow(TaskValidationError)
    expect(t.repo.get(task.id)).toEqual(task)
  })

  it('moveToSomeday refuses repeating tasks and rolls back the whole batch', () => {
    const plain = t.repo.create({ title: '한 번만', date: '2026-03-01' })
    const repeating = t.repo.create({ title: '운동', date: '2026-03-01', repeat: DAILY })

    expect(() => t.repo.moveToSomeday([plain.id, repeating.id])).toThrow(TaskValidationError)

    expect(t.repo.get(plain.id)).toEqual(plain)
    expect(t.repo.get(repeating.id)).toEqual(repeating)
  })

  it('moveToToday and reschedule still work for repeating tasks', () => {
    const repeating = t.repo.create({ title: '운동', date: '2026-03-01', repeat: DAILY })

    expect(t.repo.reschedule([repeating.id], '2026-03-20')[0]).toMatchObject({
      date: '2026-03-20',
      repeat: DAILY
    })
  })
})

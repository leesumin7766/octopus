import { describe, expect, it } from 'vitest'
import { createTestRepo } from './helpers'

// P2: 안 하기로 함(canceled) 목록은 완료 보기의 별도 거르기에서만 쓴다. 그 밖의 보기·수는 건드리지 않는다.

const TODAY = '2026-03-10'

describe('listCanceled', () => {
  it('returns only canceled tasks, newest-set-aside first (updatedAt, not doneAt)', () => {
    const t = createTestRepo('2026-03-10T09:00:00.000Z')
    const first = t.repo.create({ title: '먼저 안 한 일', date: TODAY })
    const second = t.repo.create({ title: '나중에 안 한 일', date: TODAY })
    const open = t.repo.create({ title: '그냥 열린 일', date: TODAY })
    const done = t.repo.create({ title: '끝낸 일', date: TODAY })

    t.setNow('2026-03-10T10:00:00.000Z')
    t.repo.setStatus(first.id, 'canceled')
    t.setNow('2026-03-10T11:00:00.000Z')
    t.repo.setStatus(second.id, 'canceled')
    t.setNow('2026-03-10T12:00:00.000Z')
    t.repo.setStatus(done.id, 'done')

    const list = t.repo.listCanceled()
    expect(list.map((x) => x.title)).toEqual(['나중에 안 한 일', '먼저 안 한 일'])
    expect(list.every((x) => x.status === 'canceled' && x.doneAt === null)).toBe(true)
    expect(list.map((x) => x.id)).not.toContain(open.id)
    expect(list.map((x) => x.id)).not.toContain(done.id)
  })

  it('is empty when nothing was set aside', () => {
    const t = createTestRepo()
    t.repo.create({ title: '열린 일', date: TODAY })
    expect(t.repo.listCanceled()).toEqual([])
  })

  it('does not change the open, today, done, or range views', () => {
    const t = createTestRepo('2026-03-10T09:00:00.000Z')
    const task = t.repo.create({ title: '안 한 일', date: TODAY })
    t.repo.setStatus(task.id, 'canceled')

    expect(t.repo.listView('done', TODAY)).toEqual([])
    expect(t.repo.listView('today', TODAY).today).toEqual([])
    expect(t.repo.listView('upcoming', TODAY)).toEqual([])
    expect(t.repo.listRange(TODAY, TODAY)).toEqual([])
  })

  it('reopening removes the task from the canceled list and it is open again', () => {
    const t = createTestRepo('2026-03-10T09:00:00.000Z')
    const task = t.repo.create({ title: '되돌릴 일', date: TODAY })
    t.repo.setStatus(task.id, 'canceled')
    t.repo.setStatus(task.id, 'open')

    expect(t.repo.listCanceled()).toEqual([])
    expect(t.repo.listView('today', TODAY).today.map((x) => x.title)).toEqual(['되돌릴 일'])
  })
})

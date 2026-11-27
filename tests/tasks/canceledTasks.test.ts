import { describe, expect, it } from 'vitest'
import { createTaskRepository } from '../../src/main/core/tasks/taskRepository'
import { ko } from '../../src/renderer/i18n/ko'
import { createTestRepo } from './helpers'

const TODAY = '2026-03-10'

describe('canceled (안 하기) tasks', () => {
  it('never appear in the done list, the day range, or the done-between query', () => {
    const t = createTestRepo('2026-03-10T09:00:00.000Z')
    const { repo } = t
    const done = repo.create({ title: '끝낸 일', date: TODAY })
    const canceled = repo.create({ title: '안 한 일', date: TODAY })
    t.setNow('2026-03-10T10:00:00.000Z')
    repo.setStatus(done.id, 'done')
    repo.setStatus(canceled.id, 'canceled')

    expect(repo.listView('done', TODAY).map((x) => x.title)).toEqual(['끝낸 일'])
    expect(repo.listRange(TODAY, TODAY).map((x) => x.title)).toEqual(['끝낸 일'])
    expect(repo.listDoneBetween('2026-03-10T00:00:00.000Z', '2026-03-11T00:00:00.000Z').map((x) => x.title)).toEqual([
      '끝낸 일'
    ])
  })

  it('a canceled task has no doneAt, so it cannot be counted as done', () => {
    const t = createTestRepo()
    const task = t.repo.create({ title: '안 할 일', date: TODAY })
    const canceled = t.repo.setStatus(task.id, 'canceled')
    expect(canceled.doneAt).toBeNull()
    expect(t.repo.listView('done', TODAY)).toEqual([])
  })

  it('stays canceled after the repository is rebuilt on the same database (survives remount)', () => {
    const t = createTestRepo()
    const task = t.repo.create({ title: '남아 있는 일', date: TODAY })
    t.repo.setStatus(task.id, 'canceled')

    const rebuilt = createTaskRepository(t.db, { now: () => new Date('2026-03-10T11:00:00.000Z') })
    expect(rebuilt.get(task.id)?.status).toBe('canceled')
    expect(rebuilt.listView('done', TODAY)).toEqual([])
    expect(rebuilt.listRange(TODAY, TODAY)).toEqual([])
  })

  it('reopening returns the task to its original view (today)', () => {
    const t = createTestRepo()
    const task = t.repo.create({ title: '되돌릴 일', date: TODAY })
    t.repo.setStatus(task.id, 'canceled')
    const reopened = t.repo.setStatus(task.id, 'open')

    expect(reopened).toMatchObject({ status: 'open', bucket: 'scheduled', date: TODAY })
    expect(t.repo.listView('today', TODAY).today.map((x) => x.title)).toEqual(['되돌릴 일'])
    expect(t.repo.listView('done', TODAY)).toEqual([])
  })

  it('the wording uses 안 하기 in the panel, its help text, and the undo notice', () => {
    expect(ko.tasks.detail.cancelTask).toBe('안 하기')
    expect(ko.tasks.detail.cancelHelp).toBe('안 하기로 한 할 일은 완료 보기에서 다시 열 수 있어요.')
    expect(ko.tasks.undo.canceled('할 일')).toBe('"할 일" 을(를) 안 하기로 했어요.')
  })
})

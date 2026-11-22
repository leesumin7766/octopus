import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskValidationError } from '../../src/shared/validation/task'
import { createTestRepo, type TestRepo } from './helpers'

const TODAY = '2026-03-10'

describe('task views', () => {
  let t: TestRepo

  const titles = (tasks: { title: string }[]): string[] => tasks.map((task) => task.title)

  beforeEach(() => {
    t = createTestRepo()
    const { repo } = t

    // 일부러 날짜·종류를 섞어서 만든다.
    repo.create({ title: 'inbox-1' })
    repo.create({ title: 'upcoming-far', date: '2026-03-20' })
    repo.create({ title: 'overdue-newer', date: '2026-03-09' })
    repo.create({ title: 'today-1', date: TODAY })
    repo.create({ title: 'someday-1', bucket: 'someday' })
    repo.create({ title: 'overdue-older', date: '2026-03-01' })
    repo.create({ title: 'upcoming-near', date: '2026-03-11' })
    repo.create({ title: 'inbox-2' })
    repo.create({ title: 'today-2', date: TODAY })

    const done1 = repo.create({ title: 'done-early', date: TODAY })
    const done2 = repo.create({ title: 'done-late' })
    t.setNow('2026-03-10T10:00:00.000Z')
    repo.setStatus(done1.id, 'done')
    t.setNow('2026-03-10T11:00:00.000Z')
    repo.setStatus(done2.id, 'done')

    // 취소된 항목: 오늘 날짜지만 어떤 보기에도 나오면 안 된다.
    const canceled = repo.create({ title: 'canceled-today', date: TODAY })
    repo.create({ title: 'canceled-someday', bucket: 'someday' })
    repo.setStatus(canceled.id, 'canceled')
    const cs = repo.listView('someday', TODAY).find((task) => task.title === 'canceled-someday')
    if (cs) repo.setStatus(cs.id, 'canceled')
  })

  afterEach(() => {
    t.db.close()
  })

  it('inbox: open tasks without a date, in creation order', () => {
    expect(titles(t.repo.listView('inbox', TODAY))).toEqual(['inbox-1', 'inbox-2'])
  })

  it('today: splits overdue (before today) from today, each in order', () => {
    const view = t.repo.listView('today', TODAY)

    expect(titles(view.overdue)).toEqual(['overdue-newer', 'overdue-older'])
    expect(titles(view.today)).toEqual(['today-1', 'today-2'])
  })

  it('today: depends on the "today" argument', () => {
    const view = t.repo.listView('today', '2026-03-11')

    expect(titles(view.overdue)).toEqual(['overdue-newer', 'today-1', 'overdue-older', 'today-2'])
    expect(titles(view.today)).toEqual(['upcoming-near'])
  })

  it('upcoming: scheduled after today, sorted by date', () => {
    expect(titles(t.repo.listView('upcoming', TODAY))).toEqual(['upcoming-near', 'upcoming-far'])
  })

  it('someday: open someday tasks only', () => {
    expect(titles(t.repo.listView('someday', TODAY))).toEqual(['someday-1'])
  })

  it('done: newest doneAt first', () => {
    expect(titles(t.repo.listView('done', TODAY))).toEqual(['done-late', 'done-early'])
  })

  it('canceled tasks appear in no view', () => {
    const all = [
      ...t.repo.listView('inbox', TODAY),
      ...t.repo.listView('today', TODAY).overdue,
      ...t.repo.listView('today', TODAY).today,
      ...t.repo.listView('upcoming', TODAY),
      ...t.repo.listView('someday', TODAY),
      ...t.repo.listView('done', TODAY)
    ]

    expect(titles(all).filter((title) => title.startsWith('canceled'))).toEqual([])
  })

  it('done tasks are not in the open views', () => {
    const open = [
      ...t.repo.listView('inbox', TODAY),
      ...t.repo.listView('today', TODAY).today,
      ...t.repo.listView('someday', TODAY)
    ]

    expect(titles(open).filter((title) => title.startsWith('done'))).toEqual([])
  })

  it('within a group, reorder decides the order', () => {
    const [first, second] = t.repo.listView('inbox', TODAY)
    t.repo.reorder([second.id, first.id])

    expect(titles(t.repo.listView('inbox', TODAY))).toEqual(['inbox-2', 'inbox-1'])
  })

  it('rejects a malformed "today"', () => {
    expect(() => t.repo.listView('inbox', '2026-02-30')).toThrow(TaskValidationError)
    expect(() => t.repo.listView('today', 'today')).toThrow(TaskValidationError)
  })
})

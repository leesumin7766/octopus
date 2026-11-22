import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskNotFoundError } from '../../src/main/core/tasks/taskRepository'
import { TaskValidationError } from '../../src/shared/validation/task'
import { createTestRepo, type TestRepo } from './helpers'

const TODAY = '2026-03-10'

describe('overdue cleanup', () => {
  let t: TestRepo

  beforeEach(() => {
    t = createTestRepo()
  })

  afterEach(() => {
    t.db.close()
  })

  function overdueTasks(): string[] {
    return ['a', 'b', 'c'].map((title, i) => t.repo.create({ title, date: `2026-03-0${i + 1}`, time: '09:00' }).id)
  }

  it('moveToToday moves many tasks at once', () => {
    const ids = overdueTasks()
    t.setNow('2026-03-10T12:00:00.000Z')

    const moved = t.repo.moveToToday(ids, TODAY)

    expect(moved.map((task) => task.date)).toEqual([TODAY, TODAY, TODAY])
    expect(moved.every((task) => task.bucket === 'scheduled')).toBe(true)
    expect(moved.every((task) => task.updatedAt === '2026-03-10T12:00:00.000Z')).toBe(true)
    expect(moved[0].time).toBe('09:00')
    expect(t.repo.listView('today', TODAY).overdue).toEqual([])
    expect(t.repo.listView('today', TODAY).today).toHaveLength(3)
  })

  it('moveToSomeday clears the date and time', () => {
    const ids = overdueTasks()

    const moved = t.repo.moveToSomeday(ids.slice(0, 2))

    expect(moved).toHaveLength(2)
    expect(moved.every((task) => task.bucket === 'someday' && task.date === null && task.time === null)).toBe(true)
    expect(t.repo.listView('someday', TODAY)).toHaveLength(2)
    expect(t.repo.listView('today', TODAY).overdue).toHaveLength(1)
  })

  it('reschedule moves many tasks to the given date', () => {
    const ids = overdueTasks()

    const moved = t.repo.reschedule(ids, '2026-03-25')

    expect(moved.map((task) => task.date)).toEqual(['2026-03-25', '2026-03-25', '2026-03-25'])
    expect(t.repo.listView('upcoming', TODAY)).toHaveLength(3)
  })

  it('works for an inbox task too (it becomes scheduled)', () => {
    const inbox = t.repo.create({ title: 'inbox' })

    expect(t.repo.reschedule([inbox.id], '2026-03-25')[0]).toMatchObject({
      bucket: 'scheduled',
      date: '2026-03-25'
    })
  })

  it('rolls everything back when one id does not exist', () => {
    const ids = overdueTasks()
    const before = ids.map((id) => t.repo.get(id))
    t.setNow('2026-03-10T12:00:00.000Z')

    // 없는 id 가 뒤에 있어도, 앞에서 이미 고친 것까지 되돌아가야 한다.
    expect(() => t.repo.moveToToday([...ids, 'nope'], TODAY)).toThrow(TaskNotFoundError)
    expect(() => t.repo.moveToSomeday(['nope', ...ids])).toThrow(TaskNotFoundError)
    expect(() => t.repo.reschedule([ids[0], 'nope'], '2026-03-25')).toThrow(TaskNotFoundError)

    expect(ids.map((id) => t.repo.get(id))).toEqual(before)
  })

  it('does nothing for an empty list and ignores duplicate ids', () => {
    const [first] = overdueTasks()

    expect(t.repo.moveToToday([], TODAY)).toEqual([])
    expect(t.repo.moveToToday([first, first], TODAY)).toHaveLength(1)
  })

  it('rejects an invalid date', () => {
    const ids = overdueTasks()

    expect(() => t.repo.moveToToday(ids, '2026-02-30')).toThrow(TaskValidationError)
    expect(() => t.repo.reschedule(ids, 'tomorrow')).toThrow(TaskValidationError)
  })
})

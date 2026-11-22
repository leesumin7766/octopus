import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskNotFoundError } from '../../src/main/core/tasks/taskRepository'
import { TaskValidationError } from '../../src/shared/validation/task'
import { createTestRepo, type TestRepo } from './helpers'

describe('task repository', () => {
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

  describe('create / get', () => {
    it('fills defaults for a title-only input (inbox, open)', () => {
      const task = t.repo.create({ title: '  우유 사기  ' })

      expect(task).toMatchObject({
        title: '우유 사기',
        notes: '',
        status: 'open',
        bucket: 'inbox',
        date: null,
        time: null,
        deadline: null,
        priority: 0,
        project: null,
        tags: [],
        repeat: null,
        routineId: null,
        source: null,
        order: 1,
        createdAt: '2026-03-10T09:00:00.000Z',
        updatedAt: '2026-03-10T09:00:00.000Z',
        doneAt: null
      })
      expect(task.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    })

    it('round-trips every field including JSON ones', () => {
      const created = t.repo.create({
        title: '주간 보고',
        notes: '# 메모\n- 항목',
        date: '2026-03-12',
        time: '14:30',
        deadline: '2026-03-15',
        priority: 3,
        project: '업무',
        tags: ['보고', '주간'],
        repeat: { freq: 'weekly', interval: 2, byWeekday: [1, 4] },
        routineId: 'routine-1',
        source: { arm: 'google-calendar', ref: 'evt-9', url: 'https://example.com/evt-9' }
      })

      expect(created.bucket).toBe('scheduled')
      expect(t.repo.get(created.id)).toEqual(created)
      expect(created).toMatchObject({
        tags: ['보고', '주간'],
        repeat: { freq: 'weekly', interval: 2, byWeekday: [1, 4] },
        source: { arm: 'google-calendar', ref: 'evt-9', url: 'https://example.com/evt-9' }
      })
    })

    it('returns undefined for an unknown id', () => {
      expect(t.repo.get('nope')).toBeUndefined()
    })

    it('gives increasing order values', () => {
      const a = t.repo.create({ title: 'a' })
      const b = t.repo.create({ title: 'b' })

      expect(b.order).toBeGreaterThan(a.order)
    })

    it('does not store invalid input', () => {
      expect(() => t.repo.create({ title: '   ' })).toThrow(TaskValidationError)
      expect(() => t.repo.create({ title: 'x', date: '2026-02-30' })).toThrow(TaskValidationError)
      expect(() => t.repo.create({ title: 'x', time: '25:00' })).toThrow(TaskValidationError)
      expect(() => t.repo.create({ title: 'x', bucket: 'scheduled' })).toThrow(TaskValidationError)
      expect(() => t.repo.create({ title: 'x', bucket: 'inbox', date: '2026-03-10' })).toThrow(
        TaskValidationError
      )
      expect(count()).toBe(0)
    })

    it('reports which field is wrong', () => {
      try {
        t.repo.create({ title: 'x', time: '25:00' })
        expect.unreachable()
      } catch (error) {
        expect((error as TaskValidationError).issues.map((i) => i.field)).toEqual(['time'])
      }
    })
  })

  describe('update', () => {
    it('changes fields and refreshes updatedAt only', () => {
      const created = t.repo.create({ title: 'old', notes: 'keep' })
      t.setNow('2026-03-11T10:00:00.000Z')

      const updated = t.repo.update(created.id, { title: '  new  ', priority: 2 })

      expect(updated.title).toBe('new')
      expect(updated.priority).toBe(2)
      expect(updated.notes).toBe('keep')
      expect(updated.updatedAt).toBe('2026-03-11T10:00:00.000Z')
      expect(updated.createdAt).toBe('2026-03-10T09:00:00.000Z')
      expect(updated.id).toBe(created.id)
      expect(updated.order).toBe(created.order)
    })

    it('ignores undefined values in the patch', () => {
      const created = t.repo.create({ title: 'keep me' })

      expect(t.repo.update(created.id, { title: undefined, notes: 'n' }).title).toBe('keep me')
    })

    it('can schedule a task by changing bucket and date together', () => {
      const created = t.repo.create({ title: 'a' })

      const updated = t.repo.update(created.id, { bucket: 'scheduled', date: '2026-04-01' })

      expect(updated).toMatchObject({ bucket: 'scheduled', date: '2026-04-01' })
    })

    it('rejects an inconsistent patch and leaves the task unchanged', () => {
      const created = t.repo.create({ title: 'a' })
      t.setNow('2026-03-11T10:00:00.000Z')

      expect(() => t.repo.update(created.id, { date: '2026-04-01' })).toThrow(TaskValidationError)
      expect(() => t.repo.update(created.id, { title: '' })).toThrow(TaskValidationError)

      expect(t.repo.get(created.id)).toEqual(created)
    })

    it('throws for an unknown id', () => {
      expect(() => t.repo.update('nope', { title: 'x' })).toThrow(TaskNotFoundError)
    })
  })

  describe('setStatus', () => {
    it('records doneAt for done and clears it when reopened', () => {
      const created = t.repo.create({ title: 'a' })
      t.setNow('2026-03-11T12:00:00.000Z')

      const done = t.repo.setStatus(created.id, 'done')
      expect(done).toMatchObject({
        status: 'done',
        doneAt: '2026-03-11T12:00:00.000Z',
        updatedAt: '2026-03-11T12:00:00.000Z'
      })

      t.setNow('2026-03-12T08:00:00.000Z')
      const reopened = t.repo.setStatus(created.id, 'open')
      expect(reopened).toMatchObject({ status: 'open', doneAt: null, updatedAt: '2026-03-12T08:00:00.000Z' })
    })

    it('keeps the first doneAt when marked done again', () => {
      const created = t.repo.create({ title: 'a' })
      t.setNow('2026-03-11T12:00:00.000Z')
      t.repo.setStatus(created.id, 'done')
      t.setNow('2026-03-13T12:00:00.000Z')

      expect(t.repo.setStatus(created.id, 'done').doneAt).toBe('2026-03-11T12:00:00.000Z')
    })

    it('canceled has no doneAt', () => {
      const created = t.repo.create({ title: 'a' })
      t.repo.setStatus(created.id, 'done')

      expect(t.repo.setStatus(created.id, 'canceled')).toMatchObject({ status: 'canceled', doneAt: null })
    })

    it('rejects an unknown status and an unknown id', () => {
      const created = t.repo.create({ title: 'a' })

      expect(() => t.repo.setStatus(created.id, 'archived' as never)).toThrow(TaskValidationError)
      expect(() => t.repo.setStatus('nope', 'done')).toThrow(TaskNotFoundError)
      expect(t.repo.get(created.id)?.status).toBe('open')
    })
  })

  describe('remove', () => {
    it('deletes and reports whether something was deleted', () => {
      const created = t.repo.create({ title: 'a' })

      expect(t.repo.remove(created.id)).toBe(true)
      expect(t.repo.get(created.id)).toBeUndefined()
      expect(t.repo.remove(created.id)).toBe(false)
    })
  })

  describe('reorder', () => {
    function titles(): string[] {
      return t.repo.listView('inbox', '2026-03-10').map((task) => task.title)
    }

    it('puts the tasks in the given order', () => {
      const a = t.repo.create({ title: 'a' })
      const b = t.repo.create({ title: 'b' })
      const c = t.repo.create({ title: 'c' })

      t.repo.reorder([c.id, a.id, b.id])

      expect(titles()).toEqual(['c', 'a', 'b'])
    })

    it('only swaps places among the given tasks and leaves the others where they were', () => {
      const a = t.repo.create({ title: 'a' })
      t.repo.create({ title: 'b' })
      const c = t.repo.create({ title: 'c' })

      t.repo.reorder([c.id, a.id])

      expect(titles()).toEqual(['c', 'b', 'a'])
    })

    it('updates updatedAt only for tasks that moved', () => {
      const a = t.repo.create({ title: 'a' })
      const b = t.repo.create({ title: 'b' })
      const c = t.repo.create({ title: 'c' })
      t.setNow('2026-03-11T10:00:00.000Z')

      t.repo.reorder([a.id, c.id, b.id])

      expect(t.repo.get(a.id)?.updatedAt).toBe('2026-03-10T09:00:00.000Z')
      expect(t.repo.get(b.id)?.updatedAt).toBe('2026-03-11T10:00:00.000Z')
      expect(t.repo.get(c.id)?.updatedAt).toBe('2026-03-11T10:00:00.000Z')
    })

    it('rejects duplicates and unknown ids without changing anything', () => {
      const a = t.repo.create({ title: 'a' })
      const b = t.repo.create({ title: 'b' })

      expect(() => t.repo.reorder([a.id, a.id])).toThrow(TaskValidationError)
      expect(() => t.repo.reorder([b.id, 'nope'])).toThrow(TaskNotFoundError)
      expect(titles()).toEqual(['a', 'b'])
    })
  })
})

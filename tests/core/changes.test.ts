import { describe, expect, it, vi } from 'vitest'
import { createChangeBus } from '../../src/main/core/changes'
import { notifyOnChange } from '../../src/main/core/tasks/notifying'
import { createTestRepo } from '../tasks/helpers'

describe('change bus', () => {
  it('notifies every subscriber, supports unsubscribing, and survives a subscriber that throws', () => {
    const bus = createChangeBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(() => {
      throw new Error('bad subscriber')
    })
    const offA = bus.subscribe(a)
    bus.subscribe(b)

    bus.emit()
    offA()
    bus.emit()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })
})

describe('task change notifications', () => {
  it('every change to tasks announces itself once; reading announces nothing', () => {
    const t = createTestRepo()
    const emit = vi.fn()
    const repo = notifyOnChange(t.repo, emit)

    const task = repo.create({ title: 'a' })
    repo.update(task.id, { title: 'b' })
    repo.setStatus(task.id, 'done')
    repo.moveToToday([task.id], '2026-03-10')
    repo.moveToSomeday([task.id])
    repo.reschedule([task.id], '2026-03-12')
    repo.reorder([task.id])
    repo.remove(task.id)
    expect(emit).toHaveBeenCalledTimes(8)

    emit.mockClear()
    repo.listView('inbox', '2026-03-10')
    repo.listView('today', '2026-03-10')
    repo.get(task.id)
    expect(emit).not.toHaveBeenCalled()
    t.db.close()
  })

  it('a change that fails (invalid input) does not announce, and the repository behaves the same as before', () => {
    const t = createTestRepo()
    const emit = vi.fn()
    const repo = notifyOnChange(t.repo, emit)
    expect(() => repo.create({ title: '   ' })).toThrow()
    expect(emit).not.toHaveBeenCalled()
    expect(repo.create({ title: 'ok' }).title).toBe('ok')
    t.db.close()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createTaskHandlers } from '../../src/main/ipc/tasks'
import type { TaskRepository } from '../../src/main/core/tasks/taskRepository'
import { IPC } from '../../src/shared/ipc'
import { createTestRepo } from '../tasks/helpers'

// C1-10, C1-13: 날짜 구간 IPC 가 입력을 main 에서 검사하고, 조회가 루틴 항목을 만들지 않는다.

const NOON = new Date(2026, 2, 10, 12, 0, 0)

function setup(getRepository?: () => TaskRepository | null) {
  const t = createTestRepo(NOON.toISOString())
  t.repo.create({ title: 'A 아침', date: '2026-03-10', time: '09:00' })
  const ensureRoutineTasks = vi.fn()
  const logged: { channel: string; error: unknown }[] = []
  const handlers = createTaskHandlers({
    getRepository: getRepository ?? (() => t.repo),
    now: () => NOON,
    logError: (channel, error) => logged.push({ channel, error }),
    ensureRoutineTasks
  })
  return { t, handlers, ensureRoutineTasks, logged }
}

describe('task IPC: listRange', () => {
  it('channel name is tasks:listRange', () => {
    expect(IPC.tasksListRange).toBe('tasks:listRange')
  })

  it('returns the items of the range as ok data', () => {
    const { t, handlers } = setup()
    const result = handlers.listRange('2026-03-10', '2026-03-10')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.map((x) => x.title)).toEqual(['A 아침'])
    t.db.close()
  })

  it('a day with nothing is an empty list (not an error)', () => {
    const { t, handlers } = setup()
    expect(handlers.listRange('2026-04-01', '2026-04-01')).toEqual({ ok: true, data: [] })
    t.db.close()
  })

  it('rejects wrong types, bad dates, reversed and too-wide ranges, naming the field only', () => {
    const { t, handlers } = setup()
    expect(handlers.listRange(20260310, '2026-03-10')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['from'] } })
    expect(handlers.listRange('2026-3-1', '2026-03-10')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['from'] } })
    expect(handlers.listRange('2026-02-30', '2026-03-10')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['from'] } })
    expect(handlers.listRange('2026-03-10', '2026-03-09')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['to'] } })
    expect(handlers.listRange('2026-01-01', '2026-03-04')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['to'] } })
    expect(handlers.listRange('2026-03-10', undefined)).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['to'] } })
    t.db.close()
  })

  it('the database not being open is reported as db_unavailable', () => {
    const { t, handlers } = setup(() => null)
    expect(handlers.listRange('2026-03-10', '2026-03-10')).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    t.db.close()
  })

  it('an unexpected failure becomes internal, is logged, and the message is not returned', () => {
    const broken = { listRange: () => { throw new Error('disk on fire /secret/path') } } as unknown as TaskRepository
    const { t, handlers, logged } = setup(() => broken)
    const result = handlers.listRange('2026-03-10', '2026-03-10')
    expect(result).toEqual({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(logged.map((entry) => entry.channel)).toEqual([IPC.tasksListRange])
    t.db.close()
  })

  it('reading a range does not run the routine task generation (C1-13)', () => {
    const { t, handlers, ensureRoutineTasks } = setup()
    handlers.listRange('2026-03-01', '2026-04-30')
    expect(ensureRoutineTasks).not.toHaveBeenCalled()
    t.db.close()
  })
})

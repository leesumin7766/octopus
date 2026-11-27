import { describe, expect, it, vi } from 'vitest'
import { createTaskHandlers, registerTaskHandlers, type IpcMainLike } from '../../src/main/ipc/tasks'
import type { TaskRepository } from '../../src/main/core/tasks/taskRepository'
import { IPC } from '../../src/shared/ipc'
import { createTestRepo } from '../tasks/helpers'

// P2: tasks:listCanceled 은 입력 없이 안 하기로 함 목록만 돌려준다.

const NOON = new Date(2026, 2, 10, 12, 0, 0)

function setup(getRepository?: () => TaskRepository | null) {
  const t = createTestRepo(NOON.toISOString())
  const task = t.repo.create({ title: '안 할 일', date: '2026-03-10' })
  t.repo.setStatus(task.id, 'canceled')
  const logged: { channel: string; error: unknown }[] = []
  const handlers = createTaskHandlers({
    getRepository: getRepository ?? (() => t.repo),
    now: () => NOON,
    logError: (channel, error) => logged.push({ channel, error })
  })
  return { t, handlers, logged }
}

describe('task IPC: listCanceled', () => {
  it('channel name is tasks:listCanceled', () => {
    expect(IPC.tasksListCanceled).toBe('tasks:listCanceled')
  })

  it('returns the canceled tasks as ok data', () => {
    const { t, handlers } = setup()
    const result = handlers.listCanceled()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.map((x) => x.title)).toEqual(['안 할 일'])
    t.db.close()
  })

  it('is reported as db_unavailable when the database is not open', () => {
    const { t, handlers } = setup(() => null)
    expect(handlers.listCanceled()).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    t.db.close()
  })

  it('a repository failure is reported as internal without the message', () => {
    const broken = { listCanceled: () => { throw new Error('disk on fire /secret/path') } } as unknown as TaskRepository
    const { t, handlers, logged } = setup(() => broken)
    expect(handlers.listCanceled()).toEqual({ ok: false, error: { code: 'internal' } })
    expect(logged).toHaveLength(1)
    t.db.close()
  })

  it('is registered as a channel that takes no input', () => {
    const { t, handlers } = setup()
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }
    registerTaskHandlers(ipc, handlers)
    const spy = vi.spyOn(handlers, 'listCanceled')

    const result = registered.get(IPC.tasksListCanceled)?.({ sender: 'x' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, data: [{ title: '안 할 일' }] })
    t.db.close()
  })
})

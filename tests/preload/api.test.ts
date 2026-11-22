import { beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc'

// electron 은 진짜로 불러오지 않고, preload 가 무엇을 노출하고 어떻게 호출하는지만 본다.
const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({ ok: true, data: null }))
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: { invoke: mocks.invoke }
}))

type Api = {
  getAppVersion: () => Promise<string>
  tasks: Record<string, (...args: unknown[]) => Promise<unknown>>
}

describe('preload', () => {
  let name: string
  let api: Api

  beforeAll(async () => {
    await import('../../src/preload/index')
    ;[name, api] = mocks.exposeInMainWorld.mock.calls[0] as [string, Api]
  })

  it('exposes one object named octopus', () => {
    expect(mocks.exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(name).toBe('octopus')
  })

  it('exposes only getAppVersion and tasks (no ipcRenderer, no generic invoke)', () => {
    expect(Object.keys(api).sort()).toEqual(['getAppVersion', 'tasks'])
    for (const key of ['ipcRenderer', 'invoke', 'send', 'on', 'electron']) {
      expect(key in api).toBe(false)
      expect(key in api.tasks).toBe(false)
    }
  })

  it('exposes exactly the task functions', () => {
    expect(Object.keys(api.tasks).sort()).toEqual(
      ['create', 'list', 'moveToSomeday', 'moveToToday', 'parsePreview', 'quickAdd', 'remove', 'reorder', 'reschedule', 'setStatus', 'update'].sort()
    )
    for (const fn of Object.values(api.tasks)) expect(typeof fn).toBe('function')
  })

  it.each([
    ['list', ['today'], IPC.tasksList],
    ['quickAdd', ['내일 회의'], IPC.tasksQuickAdd],
    ['create', [{ title: 'a' }], IPC.tasksCreate],
    ['update', ['ID', { title: 'b' }], IPC.tasksUpdate],
    ['setStatus', ['ID', 'done'], IPC.tasksSetStatus],
    ['remove', ['ID'], IPC.tasksRemove],
    ['reorder', [['A', 'B']], IPC.tasksReorder],
    ['moveToToday', [['A']], IPC.tasksMoveToToday],
    ['moveToSomeday', [['A']], IPC.tasksMoveToSomeday],
    ['reschedule', [['A'], '2026-03-20'], IPC.tasksReschedule],
    ['parsePreview', ['내일 회의'], IPC.tasksParsePreview]
  ])('%s forwards its arguments to the matching channel', async (method, args, channel) => {
    mocks.invoke.mockClear()

    await api.tasks[method](...(args as unknown[]))

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith(channel, ...(args as unknown[]))
  })

  it('getAppVersion uses the version channel', async () => {
    mocks.invoke.mockClear()

    await api.getAppVersion()

    expect(mocks.invoke).toHaveBeenCalledWith(IPC.appVersion)
  })
})

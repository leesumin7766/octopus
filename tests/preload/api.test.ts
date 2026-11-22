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

type Fns = Record<string, (...args: unknown[]) => Promise<unknown>>
type Api = {
  getAppVersion: () => Promise<string>
  initialView: unknown
  tasks: Fns
  routines: Fns
  memos: Fns
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

  it('exposes only getAppVersion, initialView, tasks, routines and memos (no ipcRenderer, no generic invoke)', () => {
    expect(Object.keys(api).sort()).toEqual(['getAppVersion', 'initialView', 'memos', 'routines', 'tasks'])
    for (const key of ['ipcRenderer', 'invoke', 'send', 'on', 'electron']) {
      expect(key in api).toBe(false)
      for (const group of [api.tasks, api.routines, api.memos]) expect(key in group).toBe(false)
    }
  })

  it('exposes exactly the routine and memo functions', () => {
    expect(Object.keys(api.routines).sort()).toEqual(['create', 'history', 'list', 'remove', 'update'])
    expect(Object.keys(api.memos).sort()).toEqual(['create', 'list', 'remove', 'search', 'togglePin', 'toTask', 'update'].sort())
    for (const fn of [...Object.values(api.routines), ...Object.values(api.memos)]) expect(typeof fn).toBe('function')
  })

  it.each([
    ['routines', 'list', [], IPC.routinesList],
    ['routines', 'create', [{ title: 'a', days: [1] }], IPC.routinesCreate],
    ['routines', 'update', ['ID', { active: false }], IPC.routinesUpdate],
    ['routines', 'remove', ['ID'], IPC.routinesRemove],
    ['routines', 'history', [7], IPC.routinesHistory],
    ['memos', 'list', [], IPC.memosList],
    ['memos', 'create', ['본문'], IPC.memosCreate],
    ['memos', 'update', ['ID', '고친 본문'], IPC.memosUpdate],
    ['memos', 'remove', ['ID'], IPC.memosRemove],
    ['memos', 'togglePin', ['ID'], IPC.memosTogglePin],
    ['memos', 'search', ['검색'], IPC.memosSearch],
    ['memos', 'toTask', ['ID'], IPC.memosToTask]
  ] as const)('%s.%s forwards its arguments to the matching channel', async (group, method, args, channel) => {
    mocks.invoke.mockClear()

    await api[group][method](...(args as unknown as unknown[]))

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith(channel, ...(args as unknown as unknown[]))
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

    await api.tasks[method](...(args as unknown as unknown[]))

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith(channel, ...(args as unknown as unknown[]))
  })

  it('initialView is null when main passed no argument', () => {
    expect(api.initialView).toBeNull()
  })

  it('getAppVersion uses the version channel', async () => {
    mocks.invoke.mockClear()

    await api.getAppVersion()

    expect(mocks.invoke).toHaveBeenCalledWith(IPC.appVersion)
  })
})

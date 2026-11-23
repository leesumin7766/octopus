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
  settings: Fns
  shortcuts: Fns
  command: Fns
  arms: Fns
  candidates: Fns
  calendar: Fns
  mcp: Fns
  obsidian: Fns
  update: Fns
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
    expect(Object.keys(api).sort()).toEqual(['arms', 'calendar', 'candidates', 'command', 'getAppVersion', 'initialView', 'mcp', 'memos', 'obsidian', 'routines', 'settings', 'shortcuts', 'tasks', 'update'])
    for (const key of ['ipcRenderer', 'invoke', 'send', 'on', 'electron']) {
      expect(key in api).toBe(false)
      for (const group of [api.tasks, api.routines, api.memos, api.settings, api.shortcuts, api.arms, api.candidates, api.calendar, api.mcp, api.obsidian, api.update]) expect(key in group).toBe(false)
      if (key !== 'send') expect(key in api.command).toBe(false) // command.send 는 지시 보내기(채널 고정)이지 범용 send 가 아니다.
    }
  })

  it('exposes exactly the shortcut functions, none of which takes a path or an address to open', () => {
    expect(Object.keys(api.shortcuts).sort()).toEqual(['addUrl', 'list', 'move', 'open', 'pickPath', 'remove', 'rename'])
  })

  it('exposes exactly the command functions; there is no way to read an API key', () => {
    expect(Object.keys(api.command).sort()).toEqual(
      ['clearKey', 'conversations', 'decide', 'models', 'pending', 'removeConversation', 'send', 'setKey', 'transcript'].sort()
    )
  })

  it('exposes exactly the arms and candidate functions; nothing takes an address or a path', () => {
    expect(Object.keys(api.arms).sort()).toEqual(['connect', 'disconnect', 'list', 'setAutoAccept', 'setClient'])
    expect(Object.keys(api.update).sort()).toEqual(['install', 'state'])
    expect(Object.keys(api.obsidian).sort()).toEqual(['changeVault', 'exportNow', 'fixGitignore', 'open', 'setConfig', 'state'])
    expect(Object.keys(api.mcp).sort()).toEqual(['add', 'list', 'reconnect', 'remove'])
    expect(Object.keys(api.calendar).sort()).toEqual(['openEvent', 'openWeb', 'today'])
    expect(Object.keys(api.candidates).sort()).toEqual(['accept', 'acceptAll', 'dismiss', 'dismissAll', 'list', 'openSource'])
  })

  it('exposes exactly get and set for settings', () => {
    expect(Object.keys(api.settings).sort()).toEqual(['get', 'set'])
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
    ['memos', 'toTask', ['ID'], IPC.memosToTask],
    ['settings', 'get', ['nav.collapsed'], IPC.settingsGet],
    ['settings', 'set', ['nav.collapsed', true], IPC.settingsSet],
    ['shortcuts', 'list', [], IPC.shortcutsList],
    ['shortcuts', 'addUrl', [{ url: 'https://example.com' }], IPC.shortcutsAddUrl],
    ['shortcuts', 'pickPath', ['file'], IPC.shortcutsPickPath],
    ['shortcuts', 'open', ['ID'], IPC.shortcutsOpen],
    ['shortcuts', 'rename', ['ID', '이름'], IPC.shortcutsRename],
    ['shortcuts', 'remove', ['ID'], IPC.shortcutsRemove],
    ['shortcuts', 'move', ['ID', 'up'], IPC.shortcutsMove],
    ['command', 'models', [], IPC.commandModels],
    ['command', 'setKey', ['anthropic', 'k'], IPC.commandSetKey],
    ['command', 'clearKey', ['anthropic'], IPC.commandClearKey],
    ['command', 'send', [{ conversationId: null, modelId: 'm', text: 't' }], IPC.commandSend],
    ['command', 'decide', ['ID', []], IPC.commandDecide],
    ['command', 'pending', ['ID'], IPC.commandPending],
    ['command', 'conversations', [], IPC.commandConversations],
    ['command', 'transcript', ['ID'], IPC.commandTranscript],
    ['command', 'removeConversation', ['ID'], IPC.commandRemoveConversation],
    ['arms', 'list', [], IPC.armsList],
    ['arms', 'connect', ['example'], IPC.armsConnect],
    ['arms', 'disconnect', ['example'], IPC.armsDisconnect],
    ['arms', 'setAutoAccept', ['example', true], IPC.armsSetAutoAccept],
    ['arms', 'setClient', ['example', { clientId: 'x' }], IPC.armsSetClient],
    ['update', 'state', [], IPC.updateState],
    ['update', 'install', [], IPC.updateInstall],
    ['obsidian', 'state', [], IPC.obsidianState],
    ['obsidian', 'setConfig', [{ mode: 'export' }], IPC.obsidianSetConfig],
    ['obsidian', 'changeVault', [], IPC.obsidianChangeVault],
    ['obsidian', 'exportNow', [], IPC.obsidianExportNow],
    ['obsidian', 'fixGitignore', [], IPC.obsidianFixGitignore],
    ['obsidian', 'open', [], IPC.obsidianOpen],
    ['mcp', 'list', [], IPC.mcpList],
    ['mcp', 'add', [{ name: 'x', transport: 'http', url: 'http://localhost:1/mcp' }], IPC.mcpAdd],
    ['mcp', 'remove', ['mcp-abcd1234'], IPC.mcpRemove],
    ['mcp', 'reconnect', ['mcp-abcd1234'], IPC.mcpReconnect],
    ['calendar', 'today', [], IPC.calendarToday],
    ['calendar', 'openEvent', ['ID'], IPC.calendarOpenEvent],
    ['calendar', 'openWeb', [], IPC.calendarOpenWeb],
    ['candidates', 'list', [], IPC.candidatesList],
    ['candidates', 'accept', ['ID'], IPC.candidatesAccept],
    ['candidates', 'dismiss', ['ID'], IPC.candidatesDismiss],
    ['candidates', 'acceptAll', [], IPC.candidatesAcceptAll],
    ['candidates', 'dismissAll', [], IPC.candidatesDismissAll],
    ['candidates', 'openSource', ['ID'], IPC.candidatesOpenSource]
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

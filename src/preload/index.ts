import { contextBridge, ipcRenderer } from 'electron'
import type { OctopusApi } from '../shared/api'
import { readInitialView } from '../shared/initialView'
import { IPC } from '../shared/ipc'

// 채널마다 함수를 하나씩만 노출한다. ipcRenderer 나 범용 invoke 는 넘기지 않는다.
const api: OctopusApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC.appVersion) as Promise<string>,
  // 개발용 캡처에서만 main 이 넘기는 값. 평소에는 null.
  initialView: readInitialView(process.argv),
  tasks: {
    list: (view) => ipcRenderer.invoke(IPC.tasksList, view),
    quickAdd: (text) => ipcRenderer.invoke(IPC.tasksQuickAdd, text),
    create: (input) => ipcRenderer.invoke(IPC.tasksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.tasksUpdate, id, patch),
    setStatus: (id, status) => ipcRenderer.invoke(IPC.tasksSetStatus, id, status),
    remove: (id) => ipcRenderer.invoke(IPC.tasksRemove, id),
    reorder: (ids) => ipcRenderer.invoke(IPC.tasksReorder, ids),
    moveToToday: (ids) => ipcRenderer.invoke(IPC.tasksMoveToToday, ids),
    moveToSomeday: (ids) => ipcRenderer.invoke(IPC.tasksMoveToSomeday, ids),
    reschedule: (ids, date) => ipcRenderer.invoke(IPC.tasksReschedule, ids, date),
    parsePreview: (text) => ipcRenderer.invoke(IPC.tasksParsePreview, text)
  },
  routines: {
    list: () => ipcRenderer.invoke(IPC.routinesList),
    create: (input) => ipcRenderer.invoke(IPC.routinesCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.routinesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.routinesRemove, id),
    history: (days) => ipcRenderer.invoke(IPC.routinesHistory, days)
  },
  memos: {
    list: () => ipcRenderer.invoke(IPC.memosList),
    create: (body) => ipcRenderer.invoke(IPC.memosCreate, body),
    update: (id, body) => ipcRenderer.invoke(IPC.memosUpdate, id, body),
    remove: (id) => ipcRenderer.invoke(IPC.memosRemove, id),
    togglePin: (id) => ipcRenderer.invoke(IPC.memosTogglePin, id),
    search: (query) => ipcRenderer.invoke(IPC.memosSearch, query),
    toTask: (id) => ipcRenderer.invoke(IPC.memosToTask, id)
  },
  settings: {
    get: (key) => ipcRenderer.invoke(IPC.settingsGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, key, value)
  },
  shortcuts: {
    list: () => ipcRenderer.invoke(IPC.shortcutsList),
    addUrl: (input) => ipcRenderer.invoke(IPC.shortcutsAddUrl, input),
    pickPath: (kind) => ipcRenderer.invoke(IPC.shortcutsPickPath, kind),
    open: (id) => ipcRenderer.invoke(IPC.shortcutsOpen, id),
    rename: (id, label) => ipcRenderer.invoke(IPC.shortcutsRename, id, label),
    remove: (id) => ipcRenderer.invoke(IPC.shortcutsRemove, id),
    move: (id, direction) => ipcRenderer.invoke(IPC.shortcutsMove, id, direction)
  },
  command: {
    models: () => ipcRenderer.invoke(IPC.commandModels),
    setKey: (provider, key) => ipcRenderer.invoke(IPC.commandSetKey, provider, key),
    clearKey: (provider) => ipcRenderer.invoke(IPC.commandClearKey, provider),
    send: (input) => ipcRenderer.invoke(IPC.commandSend, input),
    decide: (conversationId, decisions) => ipcRenderer.invoke(IPC.commandDecide, conversationId, decisions),
    pending: (conversationId) => ipcRenderer.invoke(IPC.commandPending, conversationId),
    conversations: () => ipcRenderer.invoke(IPC.commandConversations),
    transcript: (conversationId) => ipcRenderer.invoke(IPC.commandTranscript, conversationId),
    removeConversation: (conversationId) => ipcRenderer.invoke(IPC.commandRemoveConversation, conversationId)
  }
}

contextBridge.exposeInMainWorld('octopus', api)

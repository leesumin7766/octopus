import { contextBridge, ipcRenderer } from 'electron'
import type { OctopusApi } from '../shared/api'
import { IPC } from '../shared/ipc'

// 채널마다 함수를 하나씩만 노출한다. ipcRenderer 나 범용 invoke 는 넘기지 않는다.
const api: OctopusApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC.appVersion) as Promise<string>,
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
  }
}

contextBridge.exposeInMainWorld('octopus', api)

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

// 지금은 앱 버전 하나만 노출한다. 나머지 API 는 필요할 때 여기에 추가.
const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion) as Promise<string>
}

contextBridge.exposeInMainWorld('octopus', api)

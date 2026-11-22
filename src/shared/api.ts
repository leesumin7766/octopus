import type { TasksApi } from './tasks/ipcApi'

/** preload 가 window.octopus 로 노출하는 전체 API. */
export interface OctopusApi {
  getAppVersion: () => Promise<string>
  tasks: TasksApi
}

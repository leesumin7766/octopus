import type { MemosApi } from './memos/ipcApi'
import type { RoutinesApi } from './routines/ipcApi'
import type { SettingsApi } from './settings/ipcApi'
import type { TasksApi } from './tasks/ipcApi'
import type { InitialView } from './initialView'

/** preload 가 window.octopus 로 노출하는 전체 API. */
export interface OctopusApi {
  getAppVersion: () => Promise<string>
  /** 개발용 캡처에서만 값이 있는 읽기 전용 값. 평소에는 null. */
  initialView: InitialView | null
  tasks: TasksApi
  routines: RoutinesApi
  memos: MemosApi
  settings: SettingsApi
}

import type { ArmsApi, CandidatesApi } from './arms/ipcApi'
import type { UpdateApi } from './update/types'
import type { ObsidianApi } from './obsidian/types'
import type { McpApi } from './mcp/types'
import type { CalendarApi } from './calendar/types'
import type { CommandApi } from './command/ipcApi'
import type { MemosApi } from './memos/ipcApi'
import type { RoutinesApi } from './routines/ipcApi'
import type { SettingsApi } from './settings/ipcApi'
import type { ShortcutsApi } from './shortcuts/ipcApi'
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
  shortcuts: ShortcutsApi
  command: CommandApi
  arms: ArmsApi
  candidates: CandidatesApi
  calendar: CalendarApi
  mcp: McpApi
  obsidian: ObsidianApi
  update: UpdateApi
}

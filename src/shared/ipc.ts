// IPC 채널 이름과 응답 형식. main, preload 가 같은 상수를 쓴다.
export const IPC = {
  appVersion: 'app:version',
  tasksList: 'tasks:list',
  tasksQuickAdd: 'tasks:quickAdd',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksSetStatus: 'tasks:setStatus',
  tasksRemove: 'tasks:remove',
  tasksReorder: 'tasks:reorder',
  tasksMoveToToday: 'tasks:moveToToday',
  tasksMoveToSomeday: 'tasks:moveToSomeday',
  tasksReschedule: 'tasks:reschedule',
  tasksParsePreview: 'tasks:parsePreview',
  routinesList: 'routines:list',
  routinesCreate: 'routines:create',
  routinesUpdate: 'routines:update',
  routinesRemove: 'routines:remove',
  routinesHistory: 'routines:history',
  memosList: 'memos:list',
  memosCreate: 'memos:create',
  memosUpdate: 'memos:update',
  memosRemove: 'memos:remove',
  memosTogglePin: 'memos:togglePin',
  memosSearch: 'memos:search',
  memosToTask: 'memos:toTask',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  shortcutsList: 'shortcuts:list',
  shortcutsAddUrl: 'shortcuts:addUrl',
  shortcutsPickPath: 'shortcuts:pickPath',
  shortcutsOpen: 'shortcuts:open',
  shortcutsRename: 'shortcuts:rename',
  shortcutsRemove: 'shortcuts:remove',
  shortcutsMove: 'shortcuts:move'
} as const

/** not_found_path: 바로가기가 가리키는 파일·폴더가 없어졌다. */
export type IpcErrorCode = 'invalid_input' | 'not_found' | 'not_found_path' | 'db_unavailable' | 'internal'

export interface IpcError {
  code: IpcErrorCode
  /** invalid_input 일 때 어느 필드가 틀렸는지. 입력값은 담지 않는다. */
  fields?: string[]
}

/** 예외 대신 돌려주는 결과. 오류에는 사용자 입력이나 내부 메시지를 넣지 않는다. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

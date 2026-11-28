import type { IpcResult } from '../ipc'
import type { QuickParseOptions, QuickParseResult } from './quickParse'
import type { Task, TaskFields, TaskInput, TaskStatus, TaskView, TodayView } from './types'

/** list 의 결과: today 만 overdue/today 로 나뉜다. */
export type TaskListResult<V extends TaskView> = V extends 'today' ? TodayView : Task[]

/** preload 가 window.octopus.tasks 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다. */
export interface TasksApi {
  list<V extends TaskView>(view: V): Promise<IpcResult<TaskListResult<V>>>
  /** from..to(YYYY-MM-DD, 양 끝 포함, 최대 62일) 사이 날짜를 가진 할 일(열린 것·끝난 것). 취소는 없다. */
  listRange(from: string, to: string): Promise<IpcResult<Task[]>>
  /** 안 하기로 함(canceled) 할 일. 최근에 안 하기로 한 것부터. 완료 보기의 거르기에서만 쓴다. */
  listCanceled(): Promise<IpcResult<Task[]>>
  /** options.defaultDate·defaultTime: 문장에 날짜·시각이 없을 때 쓴다. */
  quickAdd(text: string, options?: QuickParseOptions): Promise<IpcResult<Task>>
  create(input: TaskInput): Promise<IpcResult<Task>>
  update(id: string, patch: Partial<TaskFields>): Promise<IpcResult<Task>>
  setStatus(id: string, status: TaskStatus): Promise<IpcResult<Task>>
  remove(id: string): Promise<IpcResult<null>>
  reorder(ids: string[]): Promise<IpcResult<null>>
  moveToToday(ids: string[]): Promise<IpcResult<Task[]>>
  moveToSomeday(ids: string[]): Promise<IpcResult<Task[]>>
  reschedule(ids: string[], date: string): Promise<IpcResult<Task[]>>
  /** 저장 없이 파서 결과만(입력창 미리보기용) */
  parsePreview(text: string, options?: QuickParseOptions): Promise<IpcResult<QuickParseResult>>
}

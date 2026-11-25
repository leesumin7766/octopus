import { IPC, type IpcResult } from '../../shared/ipc'
import { localDateString } from '../../shared/tasks/dates'
import { parseQuickInput, type QuickParseResult } from '../../shared/tasks/quickParse'
import type { Task, TodayView } from '../../shared/tasks/types'
import { dateRangeIssues } from '../../shared/validation/task'
import {
  parseId,
  parseIds,
  parseStatus,
  parseTaskInput,
  parseTaskPatch,
  parseText,
  parseView
} from '../../shared/validation/taskIpc'
import { TaskNotFoundError, type TaskRepository } from '../core/tasks/taskRepository'
import { dbUnavailable, invalidInput, runGuarded, type ErrorLogger, type IpcMainLike } from './result'

export type { IpcMainLike }

export interface TaskHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getRepository: () => TaskRepository | null
  /** 오늘은 여기서 구한다(렌더러가 보내지 않음). */
  now: () => Date
  /** 예상 못 한 예외의 자세한 내용은 여기에만 남긴다. */
  logError: ErrorLogger
  /** 오늘 보기를 읽기 전에 오늘의 루틴 항목을 보장한다(여러 번 불러도 하나). 루틴이 없으면 생략. */
  ensureRoutineTasks?: (today: string) => void
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한 뒤 결과 객체를 돌려준다. electron 을 쓰지 않는다. */
export interface TaskHandlers {
  list(view: unknown): IpcResult<TodayView | Task[]>
  listRange(from: unknown, to: unknown): IpcResult<Task[]>
  quickAdd(text: unknown): IpcResult<Task>
  create(input: unknown): IpcResult<Task>
  update(id: unknown, patch: unknown): IpcResult<Task>
  setStatus(id: unknown, status: unknown): IpcResult<Task>
  remove(id: unknown): IpcResult<null>
  reorder(ids: unknown): IpcResult<null>
  moveToToday(ids: unknown): IpcResult<Task[]>
  moveToSomeday(ids: unknown): IpcResult<Task[]>
  reschedule(ids: unknown, date: unknown): IpcResult<Task[]>
  parsePreview(text: unknown): IpcResult<QuickParseResult>
}

export function createTaskHandlers(deps: TaskHandlerDeps): TaskHandlers {
  const guarded = <T>(channel: string, fn: () => T): IpcResult<T> => runGuarded(channel, deps.logError, fn)

  function withRepository<T>(channel: string, fn: (repo: TaskRepository) => T): IpcResult<T> {
    const repo = deps.getRepository()
    if (!repo) return dbUnavailable()
    return guarded(channel, () => fn(repo))
  }

  const today = (): string => localDateString(deps.now())

  return {
    list(view) {
      const parsed = parseView(view)
      if (!parsed.ok) return invalidInput(parsed.field)
      const name = parsed.value
      return withRepository(IPC.tasksList, (repo) => {
        const day = today()
        if (name !== 'today') return repo.listView(name, day)
        deps.ensureRoutineTasks?.(day)
        return repo.listView('today', day)
      })
    },

    listRange(from, to) {
      // 날짜 구간만 읽는다. 오늘 보기와 달리 루틴 항목을 만들지 않는다(달력을 넘겨도 DB 가 바뀌지 않게).
      const issues = dateRangeIssues(from, to)
      if (issues.length > 0) return invalidInput(...new Set(issues.map((issue) => issue.field)))
      return withRepository(IPC.tasksListRange, (repo) => repo.listRange(from as string, to as string))
    },

    quickAdd(text) {
      const parsed = parseText(text)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.tasksQuickAdd, (repo) => {
        const p = parseQuickInput(parsed.value, today())
        return repo.create({
          title: p.title,
          date: p.date,
          time: p.time,
          project: p.project,
          priority: p.priority,
          repeat: p.repeat,
          bucket: p.bucket
        })
      })
    },

    create(input) {
      const parsed = parseTaskInput(input)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.tasksCreate, (repo) => repo.create(parsed.value))
    },

    update(id, patch) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedPatch = parseTaskPatch(patch)
      if (!parsedPatch.ok) return invalidInput(parsedPatch.field)
      return withRepository(IPC.tasksUpdate, (repo) => repo.update(parsedId.value, parsedPatch.value))
    },

    setStatus(id, status) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedStatus = parseStatus(status)
      if (!parsedStatus.ok) return invalidInput(parsedStatus.field)
      return withRepository(IPC.tasksSetStatus, (repo) => repo.setStatus(parsedId.value, parsedStatus.value))
    },

    remove(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.tasksRemove, (repo) => {
        if (!repo.remove(parsed.value)) throw new TaskNotFoundError(parsed.value)
        return null
      })
    },

    reorder(ids) {
      const parsed = parseIds(ids)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.tasksReorder, (repo) => {
        repo.reorder(parsed.value)
        return null
      })
    },

    moveToToday(ids) {
      const parsed = parseIds(ids)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.tasksMoveToToday, (repo) => repo.moveToToday(parsed.value, today()))
    },

    moveToSomeday(ids) {
      const parsed = parseIds(ids)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.tasksMoveToSomeday, (repo) => repo.moveToSomeday(parsed.value))
    },

    reschedule(ids, date) {
      const parsed = parseIds(ids)
      if (!parsed.ok) return invalidInput(parsed.field)
      // date 의 형식은 저장소가 검사해 TaskValidationError(field: 'date') 로 알려 준다.
      return withRepository(IPC.tasksReschedule, (repo) => repo.reschedule(parsed.value, date as string))
    },

    parsePreview(text) {
      const parsed = parseText(text)
      if (!parsed.ok) return invalidInput(parsed.field)
      // 저장하지 않으므로 DB 가 없어도 동작한다.
      return guarded(IPC.tasksParsePreview, () => parseQuickInput(parsed.value, today()))
    }
  }
}

/** 채널과 핸들러를 잇기만 하는 얇은 등록 함수. */
export function registerTaskHandlers(ipc: IpcMainLike, handlers: TaskHandlers): void {
  ipc.handle(IPC.tasksList, (_event, view) => handlers.list(view))
  ipc.handle(IPC.tasksListRange, (_event, from, to) => handlers.listRange(from, to))
  ipc.handle(IPC.tasksQuickAdd, (_event, text) => handlers.quickAdd(text))
  ipc.handle(IPC.tasksCreate, (_event, input) => handlers.create(input))
  ipc.handle(IPC.tasksUpdate, (_event, id, patch) => handlers.update(id, patch))
  ipc.handle(IPC.tasksSetStatus, (_event, id, status) => handlers.setStatus(id, status))
  ipc.handle(IPC.tasksRemove, (_event, id) => handlers.remove(id))
  ipc.handle(IPC.tasksReorder, (_event, ids) => handlers.reorder(ids))
  ipc.handle(IPC.tasksMoveToToday, (_event, ids) => handlers.moveToToday(ids))
  ipc.handle(IPC.tasksMoveToSomeday, (_event, ids) => handlers.moveToSomeday(ids))
  ipc.handle(IPC.tasksReschedule, (_event, ids, date) => handlers.reschedule(ids, date))
  ipc.handle(IPC.tasksParsePreview, (_event, text) => handlers.parsePreview(text))
}

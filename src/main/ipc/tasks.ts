import { IPC, type IpcError, type IpcResult } from '../../shared/ipc'
import { localDateString } from '../../shared/tasks/dates'
import { parseQuickInput, type QuickParseResult } from '../../shared/tasks/quickParse'
import type { Task, TodayView } from '../../shared/tasks/types'
import {
  parseId,
  parseIds,
  parseStatus,
  parseTaskInput,
  parseTaskPatch,
  parseText,
  parseView
} from '../../shared/validation/taskIpc'
import { TaskValidationError } from '../../shared/validation/task'
import { TaskNotFoundError, type TaskRepository } from '../core/tasks/taskRepository'

export interface TaskHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getRepository: () => TaskRepository | null
  /** 오늘은 여기서 구한다(렌더러가 보내지 않음). */
  now: () => Date
  /** 예상 못 한 예외의 자세한 내용은 여기에만 남긴다. */
  logError: (channel: string, error: unknown) => void
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한 뒤 결과 객체를 돌려준다. electron 을 쓰지 않는다. */
export interface TaskHandlers {
  list(view: unknown): IpcResult<TodayView | Task[]>
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

function failure(error: IpcError): IpcResult<never> {
  return { ok: false, error }
}

function invalidInput(...fields: string[]): IpcResult<never> {
  return failure({ code: 'invalid_input', fields })
}

export function createTaskHandlers(deps: TaskHandlerDeps): TaskHandlers {
  /** 저장소 예외를 결과 객체로 바꾼다. 입력값·메시지·스택은 응답에 넣지 않는다. */
  function toFailure(channel: string, error: unknown): IpcResult<never> {
    if (error instanceof TaskValidationError) {
      return invalidInput(...new Set(error.issues.map((issue) => issue.field)))
    }
    if (error instanceof TaskNotFoundError) return failure({ code: 'not_found' })
    deps.logError(channel, error)
    return failure({ code: 'internal' })
  }

  function guarded<T>(channel: string, fn: () => T): IpcResult<T> {
    try {
      return { ok: true, data: fn() }
    } catch (error) {
      return toFailure(channel, error)
    }
  }

  function withRepository<T>(channel: string, fn: (repo: TaskRepository) => T): IpcResult<T> {
    const repo = deps.getRepository()
    if (!repo) return failure({ code: 'db_unavailable' })
    return guarded(channel, () => fn(repo))
  }

  const today = (): string => localDateString(deps.now())

  return {
    list(view) {
      const parsed = parseView(view)
      if (!parsed.ok) return invalidInput(parsed.field)
      const name = parsed.value
      return withRepository(IPC.tasksList, (repo) =>
        name === 'today' ? repo.listView('today', today()) : repo.listView(name, today())
      )
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

/** ipcMain 이 가진 handle 만 필요하다. electron 을 import 하지 않고 테스트할 수 있게 좁혀 둔다. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/** 채널과 핸들러를 잇기만 하는 얇은 등록 함수. */
export function registerTaskHandlers(ipc: IpcMainLike, handlers: TaskHandlers): void {
  ipc.handle(IPC.tasksList, (_event, view) => handlers.list(view))
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

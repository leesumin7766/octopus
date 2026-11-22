import { IPC, type IpcResult } from '../../shared/ipc'
import type { Memo, MemoToTaskResult } from '../../shared/memos/types'
import { localDateString } from '../../shared/tasks/dates'
import { parseMemoBody, parseSearchQuery } from '../../shared/validation/memoIpc'
import { parseId } from '../../shared/validation/taskIpc'
import { MemoNotFoundError, type MemoRepository } from '../core/memos/memoRepository'
import { dbUnavailable, invalidInput, runGuarded, type ErrorLogger, type IpcMainLike } from './result'

export interface MemoHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getRepository: () => MemoRepository | null
  /** 오늘은 여기서 구한다(렌더러가 보내지 않음). */
  now: () => Date
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한 뒤 결과 객체를 돌려준다. electron 을 쓰지 않는다. */
export interface MemoHandlers {
  list(): IpcResult<Memo[]>
  create(body: unknown): IpcResult<Memo>
  update(id: unknown, body: unknown): IpcResult<Memo>
  remove(id: unknown): IpcResult<null>
  togglePin(id: unknown): IpcResult<Memo>
  search(query: unknown): IpcResult<Memo[]>
  toTask(id: unknown): IpcResult<MemoToTaskResult>
}

export function createMemoHandlers(deps: MemoHandlerDeps): MemoHandlers {
  function withRepository<T>(channel: string, fn: (repo: MemoRepository) => T): IpcResult<T> {
    const repo = deps.getRepository()
    if (!repo) return dbUnavailable()
    return runGuarded(channel, deps.logError, () => fn(repo))
  }

  return {
    list() {
      return withRepository(IPC.memosList, (repo) => repo.list())
    },

    create(body) {
      const parsed = parseMemoBody(body)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.memosCreate, (repo) => repo.create(parsed.value))
    },

    update(id, body) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedBody = parseMemoBody(body)
      if (!parsedBody.ok) return invalidInput(parsedBody.field)
      return withRepository(IPC.memosUpdate, (repo) => repo.update(parsedId.value, parsedBody.value))
    },

    remove(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.memosRemove, (repo) => {
        if (!repo.remove(parsed.value)) throw new MemoNotFoundError(parsed.value)
        return null
      })
    },

    togglePin(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.memosTogglePin, (repo) => repo.togglePin(parsed.value))
    },

    search(query) {
      const parsed = parseSearchQuery(query)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.memosSearch, (repo) => repo.search(parsed.value))
    },

    toTask(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.memosToTask, (repo) => repo.toTask(parsed.value, localDateString(deps.now())))
    }
  }
}

/** 채널과 핸들러를 잇기만 하는 얇은 등록 함수. */
export function registerMemoHandlers(ipc: IpcMainLike, handlers: MemoHandlers): void {
  ipc.handle(IPC.memosList, () => handlers.list())
  ipc.handle(IPC.memosCreate, (_event, body) => handlers.create(body))
  ipc.handle(IPC.memosUpdate, (_event, id, body) => handlers.update(id, body))
  ipc.handle(IPC.memosRemove, (_event, id) => handlers.remove(id))
  ipc.handle(IPC.memosTogglePin, (_event, id) => handlers.togglePin(id))
  ipc.handle(IPC.memosSearch, (_event, query) => handlers.search(query))
  ipc.handle(IPC.memosToTask, (_event, id) => handlers.toTask(id))
}

import { IPC, type IpcResult } from '../../shared/ipc'
import type { Routine, RoutineHistory, RoutineListData } from '../../shared/routines/types'
import { localDateString } from '../../shared/tasks/dates'
import { parseHistoryDays, parseMoveDirection, parseRoutineInput, parseRoutinePatch } from '../../shared/validation/routineIpc'
import { parseId } from '../../shared/validation/taskIpc'
import { RoutineNotFoundError, type RoutineRepository } from '../core/routines/routineRepository'
import { dbUnavailable, invalidInput, runGuarded, type ErrorLogger, type IpcMainLike } from './result'

export interface RoutineHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getRepository: () => RoutineRepository | null
  /** 오늘은 여기서 구한다(렌더러가 보내지 않음). */
  now: () => Date
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한 뒤 결과 객체를 돌려준다. electron 을 쓰지 않는다. */
export interface RoutineHandlers {
  list(): IpcResult<RoutineListData>
  create(input: unknown): IpcResult<Routine>
  update(id: unknown, patch: unknown): IpcResult<Routine>
  remove(id: unknown): IpcResult<null>
  history(days: unknown): IpcResult<RoutineHistory>
  move(id: unknown, direction: unknown): IpcResult<null>
}

export function createRoutineHandlers(deps: RoutineHandlerDeps): RoutineHandlers {
  const today = (): string => localDateString(deps.now())

  function withRepository<T>(channel: string, fn: (repo: RoutineRepository) => T): IpcResult<T> {
    const repo = deps.getRepository()
    if (!repo) return dbUnavailable()
    return runGuarded(channel, deps.logError, () => fn(repo))
  }

  return {
    list() {
      return withRepository(IPC.routinesList, (repo) => {
        const day = today()
        repo.ensureTodayTasks(day)
        return { routines: repo.list(), todayItems: repo.todayItems(day) }
      })
    },

    create(input) {
      const parsed = parseRoutineInput(input)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.routinesCreate, (repo) => repo.create(parsed.value, today()))
    },

    update(id, patch) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedPatch = parseRoutinePatch(patch)
      if (!parsedPatch.ok) return invalidInput(parsedPatch.field)
      return withRepository(IPC.routinesUpdate, (repo) => repo.update(parsedId.value, parsedPatch.value, today()))
    },

    remove(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.routinesRemove, (repo) => {
        if (!repo.remove(parsed.value, today())) throw new RoutineNotFoundError(parsed.value)
        return null
      })
    },

    history(days) {
      const parsed = parseHistoryDays(days)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.routinesHistory, (repo) => repo.history(today(), parsed.value))
    },

    move(id, direction) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedDirection = parseMoveDirection(direction)
      if (!parsedDirection.ok) return invalidInput(parsedDirection.field)
      return withRepository(IPC.routinesMove, (repo) => {
        repo.move(parsedId.value, parsedDirection.value)
        return null
      })
    }
  }
}

/** 채널과 핸들러를 잇기만 하는 얇은 등록 함수. */
export function registerRoutineHandlers(ipc: IpcMainLike, handlers: RoutineHandlers): void {
  ipc.handle(IPC.routinesList, () => handlers.list())
  ipc.handle(IPC.routinesCreate, (_event, input) => handlers.create(input))
  ipc.handle(IPC.routinesUpdate, (_event, id, patch) => handlers.update(id, patch))
  ipc.handle(IPC.routinesRemove, (_event, id) => handlers.remove(id))
  ipc.handle(IPC.routinesHistory, (_event, days) => handlers.history(days))
  ipc.handle(IPC.routinesMove, (_event, id, direction) => handlers.move(id, direction))
}

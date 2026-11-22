import { IPC, type IpcResult } from '../../shared/ipc'
import type { OpenResult, Shortcut } from '../../shared/shortcuts/types'
import { parseShortcutUrl } from '../../shared/validation/shortcut'
import { parseAddUrlInput, parseLabel, parseMoveDirection, parsePathKind } from '../../shared/validation/shortcutIpc'
import { parseId } from '../../shared/validation/taskIpc'
import { isExecutablePath } from '../core/shortcuts/executable'
import { ShortcutNotFoundError, type ShortcutRepository } from '../core/shortcuts/shortcutRepository'
import type { ShortcutPlatform } from '../platform/shortcutPlatform'
import { dbUnavailable, failure, invalidInput, runGuarded, toFailure, type ErrorLogger, type IpcMainLike } from './result'

export interface ShortcutHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getRepository: () => ShortcutRepository | null
  platform: ShortcutPlatform
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한 뒤 결과 객체를 돌려준다. electron 을 쓰지 않는다. */
export interface ShortcutHandlers {
  list(): IpcResult<Shortcut[]>
  addUrl(input: unknown): IpcResult<Shortcut>
  pickPath(kind: unknown): Promise<IpcResult<Shortcut | null>>
  open(id: unknown): Promise<IpcResult<OpenResult>>
  rename(id: unknown, label: unknown): IpcResult<Shortcut>
  remove(id: unknown): IpcResult<null>
  move(id: unknown, direction: unknown): IpcResult<null>
}

export function createShortcutHandlers(deps: ShortcutHandlerDeps): ShortcutHandlers {
  function withRepository<T>(channel: string, fn: (repo: ShortcutRepository) => T): IpcResult<T> {
    const repo = deps.getRepository()
    if (!repo) return dbUnavailable()
    return runGuarded(channel, deps.logError, () => fn(repo))
  }

  return {
    list() {
      return withRepository(IPC.shortcutsList, (repo) => repo.list())
    },

    addUrl(input) {
      const parsed = parseAddUrlInput(input)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.shortcutsAddUrl, (repo) => repo.createUrl(parsed.value))
    },

    async pickPath(kind) {
      const parsed = parsePathKind(kind)
      if (!parsed.ok) return invalidInput(parsed.field)
      const repo = deps.getRepository()
      if (!repo) return dbUnavailable()

      try {
        // 경로는 여기서 연 대화상자가 돌려준 값만 쓴다. 렌더러가 보낸 문자열은 어디에도 쓰이지 않는다.
        const picked = await deps.platform.pickPath(parsed.value)
        if (picked === null) return { ok: true, data: null } // 취소하면 저장하지 않는다.
        return { ok: true, data: repo.createPath({ path: picked, pathType: parsed.value }) }
      } catch (error) {
        return toFailure(IPC.shortcutsPickPath, error, deps.logError)
      }
    },

    async open(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      const repo = deps.getRepository()
      if (!repo) return dbUnavailable()

      try {
        // 무엇을 열지는 DB 에 저장된 값으로만 정한다.
        const shortcut = repo.get(parsed.value)
        if (!shortcut) throw new ShortcutNotFoundError(parsed.value)

        if (shortcut.kind === 'url') {
          const url = parseShortcutUrl(shortcut.target)
          if (url === null) throw new Error('stored shortcut address is not an http(s) address')
          await deps.platform.openExternal(url)
          return { ok: true, data: { opened: true } }
        }

        if (!deps.platform.pathExists(shortcut.target)) return failure({ code: 'not_found_path' })

        // 프로그램·스크립트는 처음 열 때 사용자에게 확인을 받고, 허용하면 이 바로가기에 기억해 둔다.
        if (isExecutablePath(shortcut.target) && !shortcut.allowed) {
          const allowed = await deps.platform.confirmRunExecutable({ label: shortcut.label, path: shortcut.target })
          if (!allowed) return { ok: true, data: { opened: false } }
          repo.setAllowed(shortcut.id)
        }

        const problem = await deps.platform.openPath(shortcut.target)
        if (problem !== '') throw new Error(`could not open the path: ${problem}`)
        return { ok: true, data: { opened: true } }
      } catch (error) {
        return toFailure(IPC.shortcutsOpen, error, deps.logError)
      }
    },

    rename(id, label) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedLabel = parseLabel(label)
      if (!parsedLabel.ok) return invalidInput(parsedLabel.field)
      return withRepository(IPC.shortcutsRename, (repo) => repo.rename(parsedId.value, parsedLabel.value))
    },

    remove(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepository(IPC.shortcutsRemove, (repo) => {
        if (!repo.remove(parsed.value)) throw new ShortcutNotFoundError(parsed.value)
        return null
      })
    },

    move(id, direction) {
      const parsedId = parseId(id)
      if (!parsedId.ok) return invalidInput(parsedId.field)
      const parsedDirection = parseMoveDirection(direction)
      if (!parsedDirection.ok) return invalidInput(parsedDirection.field)
      return withRepository(IPC.shortcutsMove, (repo) => {
        repo.move(parsedId.value, parsedDirection.value)
        return null
      })
    }
  }
}

/** 채널과 핸들러를 잇기만 하는 얇은 등록 함수. 각 채널은 정해진 인자만 넘기고 나머지는 버린다. */
export function registerShortcutHandlers(ipc: IpcMainLike, handlers: ShortcutHandlers): void {
  ipc.handle(IPC.shortcutsList, () => handlers.list())
  ipc.handle(IPC.shortcutsAddUrl, (_event, input) => handlers.addUrl(input))
  ipc.handle(IPC.shortcutsPickPath, (_event, kind) => handlers.pickPath(kind))
  ipc.handle(IPC.shortcutsOpen, (_event, id) => handlers.open(id))
  ipc.handle(IPC.shortcutsRename, (_event, id, label) => handlers.rename(id, label))
  ipc.handle(IPC.shortcutsRemove, (_event, id) => handlers.remove(id))
  ipc.handle(IPC.shortcutsMove, (_event, id, direction) => handlers.move(id, direction))
}

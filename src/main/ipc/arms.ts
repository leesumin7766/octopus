import type { ArmInfo, InboxCandidate } from '../../shared/arms/types'
import { IPC, type IpcResult } from '../../shared/ipc'
import type { Task } from '../../shared/tasks/types'
import { parseShortcutUrl } from '../../shared/validation/shortcut'
import { bad, parseId } from '../../shared/validation/taskIpc'
import type { ArmManager } from '../arms/sdk/manager'
import { EntityNotFoundError } from '../core/errors'
import type { CandidateRepository } from '../core/inbox/candidateRepository'
import { dbUnavailable, failure, invalidInput, runGuarded, toFailure, type ErrorLogger, type IpcMainLike } from './result'

export interface ArmsHandlerDeps {
  getManager: () => ArmManager | null
  /** DB 를 열지 못했으면 null */
  getCandidates: () => CandidateRepository | null
  /** 링크를 기본 브라우저로 연다(http/https 만) */
  openExternal: (url: string) => Promise<void>
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한다. electron 을 쓰지 않는다. */
export interface ArmsHandlers {
  list(): IpcResult<ArmInfo[]>
  connect(id: unknown): Promise<IpcResult<ArmInfo>>
  disconnect(id: unknown): Promise<IpcResult<ArmInfo>>
  setAutoAccept(id: unknown, on: unknown): IpcResult<ArmInfo>
}

export interface CandidateHandlers {
  list(): IpcResult<InboxCandidate[]>
  accept(id: unknown): IpcResult<Task>
  dismiss(id: unknown): IpcResult<null>
  acceptAll(): IpcResult<number>
  dismissAll(): IpcResult<number>
  openSource(id: unknown): Promise<IpcResult<null>>
}

const ARM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const parseArmId = (value: unknown): { ok: true; value: string } | { ok: false; field: string } =>
  typeof value === 'string' && ARM_ID.test(value) ? { ok: true, value } : bad('id')

export function createArmsHandlers(deps: ArmsHandlerDeps): ArmsHandlers {
  const manager = (): ArmManager | null => deps.getManager()

  return {
    list() {
      const m = manager()
      if (!m) return dbUnavailable()
      return runGuarded(IPC.armsList, deps.logError, () => m.list())
    },

    async connect(id) {
      const parsed = parseArmId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      const m = manager()
      if (!m) return dbUnavailable()
      try {
        const info = await m.connect(parsed.value)
        return info ? { ok: true, data: info } : failure({ code: 'not_found' })
      } catch (error) {
        return toFailure(IPC.armsConnect, error, deps.logError)
      }
    },

    async disconnect(id) {
      const parsed = parseArmId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      const m = manager()
      if (!m) return dbUnavailable()
      try {
        const info = await m.disconnect(parsed.value)
        return info ? { ok: true, data: info } : failure({ code: 'not_found' })
      } catch (error) {
        return toFailure(IPC.armsDisconnect, error, deps.logError)
      }
    },

    setAutoAccept(id, on) {
      const parsed = parseArmId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      if (typeof on !== 'boolean') return invalidInput('on')
      const m = manager()
      if (!m) return dbUnavailable()
      return runGuarded(IPC.armsSetAutoAccept, deps.logError, () => {
        const info = m.setAutoAccept(parsed.value, on)
        if (!info) throw new EntityNotFoundError('arm', parsed.value)
        return info
      })
    }
  }
}

export function createCandidateHandlers(deps: ArmsHandlerDeps): CandidateHandlers {
  const withRepo = <T>(channel: string, fn: (repo: CandidateRepository) => T): IpcResult<T> => {
    const repo = deps.getCandidates()
    if (!repo) return dbUnavailable()
    return runGuarded(channel, deps.logError, () => fn(repo))
  }

  return {
    list: () => withRepo(IPC.candidatesList, (repo) => repo.listPending()),

    accept(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepo(IPC.candidatesAccept, (repo) => repo.accept(parsed.value))
    },

    dismiss(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      return withRepo(IPC.candidatesDismiss, (repo) => {
        repo.dismiss(parsed.value)
        return null
      })
    },

    acceptAll: () => withRepo(IPC.candidatesAcceptAll, (repo) => repo.acceptAll()),
    dismissAll: () => withRepo(IPC.candidatesDismissAll, (repo) => repo.dismissAll()),

    async openSource(id) {
      const parsed = parseId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      const repo = deps.getCandidates()
      if (!repo) return dbUnavailable()
      try {
        // 열 주소는 id 로 찾은 저장값뿐이다. 렌더러가 보낸 문자열은 어디에도 쓰이지 않는다.
        const candidate = repo.get(parsed.value)
        if (!candidate) return failure({ code: 'not_found' })
        if (candidate.url === null || parseShortcutUrl(candidate.url) === null) return invalidInput('url')
        await deps.openExternal(candidate.url)
        return { ok: true, data: null }
      } catch (error) {
        return toFailure(IPC.candidatesOpenSource, error, deps.logError)
      }
    }
  }
}

export function registerArmsHandlers(ipc: IpcMainLike, arms: ArmsHandlers, candidates: CandidateHandlers): void {
  ipc.handle(IPC.armsList, () => arms.list())
  ipc.handle(IPC.armsConnect, (_e, id) => arms.connect(id))
  ipc.handle(IPC.armsDisconnect, (_e, id) => arms.disconnect(id))
  ipc.handle(IPC.armsSetAutoAccept, (_e, id, on) => arms.setAutoAccept(id, on))
  ipc.handle(IPC.candidatesList, () => candidates.list())
  ipc.handle(IPC.candidatesAccept, (_e, id) => candidates.accept(id))
  ipc.handle(IPC.candidatesDismiss, (_e, id) => candidates.dismiss(id))
  ipc.handle(IPC.candidatesAcceptAll, () => candidates.acceptAll())
  ipc.handle(IPC.candidatesDismissAll, () => candidates.dismissAll())
  ipc.handle(IPC.candidatesOpenSource, (_e, id) => candidates.openSource(id))
}

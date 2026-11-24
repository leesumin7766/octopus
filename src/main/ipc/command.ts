import type { CommandSession, EmitEvent } from '../core/command/session'
import type { ConversationRepository } from '../core/command/conversationRepository'
import type { KeyStore } from '../core/command/adapterResolver'
import { SecureStoreError } from '../platform/secureStore'
import type { ConversationSummary, ModelEntry, PendingApproval, TranscriptItem, TurnState } from '../../shared/command/types'
import type { ModelsInfo } from '../../shared/command/ipcApi'
import { IPC, type IpcResult } from '../../shared/ipc'
import { parseApiKey, parseCancelTarget, parseDecisions, parseProvider, parseSendInput } from '../../shared/validation/command'
import { isUlid, parseId } from '../../shared/validation/taskIpc'
import { dbUnavailable, failure, invalidInput, toFailure, type ErrorLogger, type IpcMainLike } from './result'

export interface CommandHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getSession: () => CommandSession | null
  getRepository: () => ConversationRepository | null
  getModels: () => ModelEntry[]
  keys: KeyStore
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한다. electron 을 쓰지 않는다. */
export interface CommandHandlers {
  models(): IpcResult<ModelsInfo>
  setKey(provider: unknown, key: unknown): IpcResult<null>
  clearKey(provider: unknown): IpcResult<null>
  /** emit 은 보낸 창으로 진행 이벤트를 밀어 주는 함수, owner 는 보낸 창(창이 닫히면 그 창의 요청만 멈추는 데 쓴다) */
  send(input: unknown, emit?: EmitEvent, owner?: unknown): Promise<IpcResult<TurnState>>
  decide(conversationId: unknown, decisions: unknown, emit?: EmitEvent, owner?: unknown): Promise<IpcResult<TurnState>>
  cancel(conversationId: unknown): Promise<IpcResult<null>>
  /** 이 창이 보낸 진행 중인 요청을 모두 중지한다(창이 닫혔을 때). */
  cancelOwner(owner: unknown): void
  pending(conversationId: unknown): IpcResult<PendingApproval[]>
  conversations(): IpcResult<ConversationSummary[]>
  transcript(conversationId: unknown): IpcResult<TranscriptItem[]>
  removeConversation(conversationId: unknown): IpcResult<null>
}

export function createCommandHandlers(deps: CommandHandlerDeps): CommandHandlers {
  const guarded = <T>(channel: string, fn: () => T): IpcResult<T> => {
    try {
      return { ok: true, data: fn() }
    } catch (error) {
      return keyFailure(channel, error)
    }
  }
  const keyFailure = (channel: string, error: unknown): IpcResult<never> =>
    error instanceof SecureStoreError ? failure({ code: 'secure_unavailable' }) : toFailure(channel, error, deps.logError)

  const hasKey = (provider: 'anthropic' | 'openai-compatible'): boolean => {
    try {
      return !!deps.keys.get(provider)
    } catch {
      return false
    }
  }

  return {
    models() {
      return guarded(IPC.commandModels, () => ({
        models: deps.getModels(),
        hasKey: { anthropic: hasKey('anthropic'), 'openai-compatible': hasKey('openai-compatible') }
      }))
    },

    setKey(provider, key) {
      const p = parseProvider(provider)
      if (!p.ok) return invalidInput(p.field)
      const k = parseApiKey(key)
      if (!k.ok) return invalidInput(k.field)
      return guarded(IPC.commandSetKey, () => {
        deps.keys.set(p.value, k.value)
        return null
      })
    },

    clearKey(provider) {
      const p = parseProvider(provider)
      if (!p.ok) return invalidInput(p.field)
      return guarded(IPC.commandClearKey, () => {
        deps.keys.delete(p.value)
        return null
      })
    },

    async send(input, emit, owner) {
      const parsed = parseSendInput(input, isUlid)
      if (!parsed.ok) return invalidInput(parsed.field)
      const session = deps.getSession()
      if (!session) return dbUnavailable()
      try {
        return { ok: true, data: await session.send(parsed.value, emit, owner) }
      } catch (error) {
        return toFailure(IPC.commandSend, error, deps.logError)
      }
    },

    async decide(conversationId, decisions, emit, owner) {
      const id = parseId(conversationId)
      if (!id.ok) return invalidInput(id.field)
      const d = parseDecisions(decisions)
      if (!d.ok) return invalidInput(d.field)
      const session = deps.getSession()
      if (!session) return dbUnavailable()
      try {
        return { ok: true, data: await session.decide(id.value, d.value, emit, owner) }
      } catch (error) {
        return toFailure(IPC.commandDecide, error, deps.logError)
      }
    },

    async cancel(conversationId) {
      const target = parseCancelTarget(conversationId, isUlid)
      if (!target.ok) return invalidInput(target.field)
      const session = deps.getSession()
      if (!session) return dbUnavailable()
      try {
        await session.cancel(target.value)
        return { ok: true, data: null }
      } catch (error) {
        return toFailure(IPC.commandCancel, error, deps.logError)
      }
    },

    cancelOwner(owner) {
      try {
        deps.getSession()?.cancelOwner(owner)
      } catch (error) {
        deps.logError(IPC.commandCancel, error)
      }
    },

    pending(conversationId) {
      const id = parseId(conversationId)
      if (!id.ok) return invalidInput(id.field)
      const session = deps.getSession()
      if (!session) return dbUnavailable()
      return guarded(IPC.commandPending, () => session.pending(id.value))
    },

    conversations() {
      const repo = deps.getRepository()
      if (!repo) return dbUnavailable()
      return guarded(IPC.commandConversations, () => repo.list())
    },

    transcript(conversationId) {
      const id = parseId(conversationId)
      if (!id.ok) return invalidInput(id.field)
      const session = deps.getSession()
      if (!session) return dbUnavailable()
      return guarded(IPC.commandTranscript, () => session.transcript(id.value))
    },

    removeConversation(conversationId) {
      const id = parseId(conversationId)
      if (!id.ok) return invalidInput(id.field)
      const repo = deps.getRepository()
      if (!repo) return dbUnavailable()
      return guarded(IPC.commandRemoveConversation, () => {
        repo.remove(id.value)
        return null
      })
    }
  }
}

/**
 * IPC 이벤트를 보낸 그 창(webContents)으로만 진행 이벤트를 밀어 주는 함수를 만든다.
 * 창이 이미 닫혔으면 아무것도 하지 않는다. 보낸 창을 알 수 없으면 undefined(이벤트 없이 결과만).
 */
export function senderEmitter(event: unknown): EmitEvent | undefined {
  const sender = (event as { sender?: { send?: unknown; isDestroyed?: unknown } } | null)?.sender
  if (!sender || typeof sender.send !== 'function') return undefined
  const target = sender as { send: (channel: string, ...args: unknown[]) => void; isDestroyed?: () => boolean }
  return (payload) => {
    if (typeof target.isDestroyed === 'function' && target.isDestroyed()) return
    target.send(IPC.commandEvent, payload)
  }
}

/**
 * 요청을 보낸 창(webContents)을 알아내고, 그 창이 닫히면(destroyed) 그 창이 보낸 진행 중인 요청을 모두 멈추도록 한 번만 걸어 둔다.
 * 보낸 창을 알 수 없으면 undefined.
 */
function senderOwner(event: unknown, h: CommandHandlers, watched: WeakSet<object>): object | undefined {
  const sender = (event as { sender?: unknown } | null)?.sender
  if (typeof sender !== 'object' || sender === null) return undefined
  const contents = sender as { once?: unknown }
  if (!watched.has(sender) && typeof contents.once === 'function') {
    watched.add(sender)
    ;(contents.once as (event: string, listener: () => void) => void).call(sender, 'destroyed', () => h.cancelOwner(sender))
  }
  return sender
}

export function registerCommandHandlers(ipc: IpcMainLike, h: CommandHandlers): void {
  const watched = new WeakSet<object>()
  ipc.handle(IPC.commandModels, () => h.models())
  ipc.handle(IPC.commandSetKey, (_e, provider, key) => h.setKey(provider, key))
  ipc.handle(IPC.commandClearKey, (_e, provider) => h.clearKey(provider))
  ipc.handle(IPC.commandSend, (event, input) => h.send(input, senderEmitter(event), senderOwner(event, h, watched)))
  ipc.handle(IPC.commandDecide, (event, id, decisions) => h.decide(id, decisions, senderEmitter(event), senderOwner(event, h, watched)))
  ipc.handle(IPC.commandCancel, (_e, id) => h.cancel(id))
  ipc.handle(IPC.commandPending, (_e, id) => h.pending(id))
  ipc.handle(IPC.commandConversations, () => h.conversations())
  ipc.handle(IPC.commandTranscript, (_e, id) => h.transcript(id))
  ipc.handle(IPC.commandRemoveConversation, (_e, id) => h.removeConversation(id))
}

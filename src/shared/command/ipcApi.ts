import type { IpcResult } from '../ipc'
import type { ConversationSummary, LlmProvider, ModelEntry, PendingApproval, TranscriptItem, TurnState } from './types'

export interface ModelsInfo {
  models: ModelEntry[]
  /** 제공자별 키가 저장돼 있는지. 키 값은 어떤 채널로도 돌려주지 않는다. */
  hasKey: Record<LlmProvider, boolean>
}

/**
 * preload 가 window.octopus.command 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다.
 * API 키는 쓰기 전용이다(setKey/clearKey). 읽는 채널은 없다.
 */
export interface CommandApi {
  models(): Promise<IpcResult<ModelsInfo>>
  setKey(provider: LlmProvider, key: string): Promise<IpcResult<null>>
  clearKey(provider: LlmProvider): Promise<IpcResult<null>>
  /** conversationId 가 null 이면 새 대화. 쓰기 도구는 승인 대기(awaiting_approval)로 멈춘다. */
  send(input: { conversationId: string | null; modelId: string; text: string }): Promise<IpcResult<TurnState>>
  decide(conversationId: string, decisions: { callId: string; approve: boolean }[]): Promise<IpcResult<TurnState>>
  pending(conversationId: string): Promise<IpcResult<PendingApproval[]>>
  conversations(): Promise<IpcResult<ConversationSummary[]>>
  transcript(conversationId: string): Promise<IpcResult<TranscriptItem[]>>
  removeConversation(conversationId: string): Promise<IpcResult<null>>
}

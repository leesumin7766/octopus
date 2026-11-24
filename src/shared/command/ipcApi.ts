import type { IpcResult } from '../ipc'
import type { CommandEvent, ConversationSummary, LlmProvider, ModelEntry, PendingApproval, TranscriptItem, TurnState } from './types'

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
  /**
   * 진행 중인 요청을 중지한다. 대화 id 를 아직 모르면(새 대화의 첫 응답 전) null 로 모두 중지한다.
   * 중지된 턴의 결과는 send/decide 가 그대로 돌려준다(받은 글만 "(중지됨)" 과 함께 남는다).
   */
  cancel(conversationId: string | null): Promise<IpcResult<null>>
  /** 진행 이벤트를 받는다(이 창에만 온다). 돌려주는 함수로 구독을 끝낸다. */
  onEvent(listener: (event: CommandEvent) => void): () => void
}

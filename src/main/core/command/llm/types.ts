import type { CommandErrorKind, ContentBlock, Message, StopReason, Usage } from '../../../../shared/command/types'

/** 모델에 알려 주는 도구 한 개. inputSchema 는 JSON Schema(object). */
export interface LlmTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** false 면 strict 로 보내지 않는다(스키마가 strict 규칙을 따르지 않는 바깥 도구). 생략하면 true. */
  strict?: boolean
}

export interface ChatRequest {
  system: string
  messages: Message[]
  tools: LlmTool[]
  signal?: AbortSignal
}

export interface ChatResponse {
  content: ContentBlock[]
  stopReason: StopReason
  usage: Usage
}

/** 제공자와 상관없는 공통 인터페이스. 어댑터는 주입받은 클라이언트/fetch 로만 통신한다. */
export interface LlmAdapter {
  chat(request: ChatRequest): Promise<ChatResponse>
}

/** 어댑터가 던지는 유일한 예외. 메시지에는 키·요청 본문을 넣지 않는다. */
export class LlmError extends Error {
  readonly kind: CommandErrorKind

  constructor(kind: CommandErrorKind, message: string) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

export function statusToKind(status: number | undefined): CommandErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 413) return 'too_long'
  if (status === 529 || (status !== undefined && status >= 500)) return 'overloaded'
  if (status !== undefined && status >= 400) return 'bad_request'
  return 'unknown'
}

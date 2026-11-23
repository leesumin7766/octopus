// 지시하기(LLM 명령창)의 main·renderer 공용 타입.

export type LlmProvider = 'anthropic' | 'openai-compatible'

/** 설정 파일(command.models)에 적는 모델 한 개. 키는 여기에 넣지 않는다(보안 저장소). */
export interface ModelEntry {
  /** 목록 안에서 겹치지 않는 이름 */
  id: string
  provider: LlmProvider
  /** API 에 보내는 모델 이름 */
  model: string
  label: string
  /** openai-compatible 에서만. 예: https://api.openai.com/v1 */
  baseUrl?: string
  /** anthropic 에서만 */
  effort?: 'low' | 'medium' | 'high'
}

export const DEFAULT_MODELS: readonly ModelEntry[] = [
  { id: 'anthropic-opus', provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', effort: 'medium' },
  { id: 'anthropic-sonnet', provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', effort: 'medium' },
  { id: 'anthropic-haiku', provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
]

/** 대화에 쌓이는 내용 블록. 어댑터 사이에서 공통으로 쓰는 모양. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  /** 제공자가 준 블록(예: thinking)을 고치지 않고 그대로 되돌려 보내기 위한 보관용 */
  | { type: 'opaque'; provider: LlmProvider; raw: unknown }

export interface Message {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface ConversationSummary {
  id: string
  title: string
  modelId: string
  createdAt: string
  updatedAt: string
}

/** 승인 대기 중인 쓰기 동작의 미리보기 카드 내용 */
export interface ApprovalPreview {
  /** 무엇을 */
  title: string
  /** 어디에·어떻게 바뀌는지 한 줄씩 */
  lines: string[]
}

/** 도구 출처: core, 'mcp:<서버 id>', 'arm:<id>' */
export type ToolSource = 'core' | 'mcp' | `mcp:${string}` | `arm:${string}`

export interface PendingApproval {
  /** tool_use id */
  callId: string
  toolName: string
  /** 도구가 어디서 왔는지 */
  source: ToolSource
  preview: ApprovalPreview
}

/** 화면에 보여 줄 대화 항목 */
export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; source: ToolSource; readOnly: boolean; status: 'done' | 'error' | 'rejected'; summary: string }

export interface TurnState {
  conversationId: string
  status: 'done' | 'awaiting_approval' | 'error'
  /** 이번 턴에서 새로 생긴 항목 */
  items: TranscriptItem[]
  pending: PendingApproval[]
  /** status === 'error' 일 때 사용자에게 보일 분류 */
  error?: CommandErrorKind
}

export type CommandErrorKind =
  | 'no_key'
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'overloaded'
  | 'bad_request'
  | 'refusal'
  | 'too_long'
  | 'step_limit'
  | 'unknown'

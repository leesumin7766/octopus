import type { ContentBlock, StopReason } from '../../../../shared/command/types'
import { LlmError, statusToKind, type ChatRequest, type ChatResponse, type LlmAdapter } from './types'

/** SDK 클라이언트 중 쓰는 부분만. 테스트에서는 가짜를 넣는다. */
export interface AnthropicClientLike {
  messages: { create(params: Record<string, unknown>): Promise<AnthropicResponse> }
  beta: { messages: { create(params: Record<string, unknown>): Promise<AnthropicResponse> } }
}

export interface AnthropicResponse {
  content: Array<Record<string, unknown> & { type: string }>
  stop_reason: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface AnthropicAdapterOptions {
  client: AnthropicClientLike
  model: string
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  /** 서버 쪽 대체 모델(fallback). 기본 켜짐. Haiku 5.5 에는 보내지 않는다. */
  fallbacks?: boolean
}

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

function supportsFallbacks(model: string): boolean {
  return !model.startsWith('claude-haiku-5-5')
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'other'
  }
}

function toWire(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: block.toolUseId, content: block.content, ...(block.isError ? { is_error: true } : {}) }
    case 'opaque':
      return block.raw as Record<string, unknown> // thinking 블록 등은 고치지 않고 그대로
  }
}

function fromWire(block: Record<string, unknown> & { type: string }): ContentBlock {
  if (block.type === 'text') return { type: 'text', text: String(block.text ?? '') }
  if (block.type === 'tool_use') return { type: 'tool_use', id: String(block.id), name: String(block.name), input: block.input }
  return { type: 'opaque', provider: 'anthropic', raw: block }
}

/** SDK 오류를 모양만 보고 분류한다(연결 오류를 상태 오류보다 먼저). 원문 메시지는 버린다. */
export function classifyAnthropicError(error: unknown): LlmError {
  if (error instanceof LlmError) return error
  const e = error as { name?: string; status?: number } | null
  const name = e?.name ?? ''
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return new LlmError('network', 'network error')
  if (name === 'APIUserAbortError') return new LlmError('unknown', 'aborted')
  if (typeof e?.status === 'number') return new LlmError(statusToKind(e.status), `api status ${e.status}`)
  return new LlmError('unknown', 'unexpected error')
}

export function createAnthropicAdapter(options: AnthropicAdapterOptions): LlmAdapter {
  const useFallbacks = (options.fallbacks ?? true) && supportsFallbacks(options.model)

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const params: Record<string, unknown> = {
        model: options.model,
        max_tokens: options.maxTokens ?? 16000,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content.map(toWire) })),
        // 강제 호출(tool_choice any/tool)은 Opus/Sonnet 5.5 에서 400 이라 auto 만 쓴다(기본값이지만 명시).
        tool_choice: { type: 'auto' }
      }
      if (options.effort) params.output_config = { effort: options.effort }
      if (request.tools.length > 0) {
        params.tools = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, ...(t.strict === false ? {} : { strict: true }) }))
      }

      try {
        let response: AnthropicResponse
        if (useFallbacks) {
          response = await options.client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        } else {
          response = await options.client.messages.create(params)
        }
        return {
          content: response.content.map(fromWire),
          stopReason: mapStop(response.stop_reason),
          usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }
        }
      } catch (error) {
        throw classifyAnthropicError(error)
      }
    }
  }
}

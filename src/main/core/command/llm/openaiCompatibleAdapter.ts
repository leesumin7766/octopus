import type { ContentBlock, Message, StopReason } from '../../../../shared/command/types'
import { LlmError, statusToKind, type ChatRequest, type ChatResponse, type LlmAdapter } from './types'

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface OpenAiAdapterOptions {
  fetch: FetchLike
  /** 예: https://api.openai.com/v1 (끝의 / 는 있어도 없어도 됨) */
  baseUrl: string
  model: string
  /** 키가 필요 없는 로컬 서버면 빈 값 */
  apiKey: string
  maxTokens?: number
}

interface WireMessage {
  role: string
  content?: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

function toWire(messages: Message[], system: string): WireMessage[] {
  const out: WireMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('')
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
          : {})
      })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content })
        else if (b.type === 'text') out.push({ role: 'user', content: b.text })
      }
    }
  }
  return out
}

function mapFinish(reason: unknown, hasTools: boolean): StopReason {
  if (hasTools || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'content_filter') return 'refusal'
  if (reason === 'stop' || reason === null || reason === undefined) return 'end_turn'
  return 'other'
}

export function createOpenAiCompatibleAdapter(options: OpenAiAdapterOptions): LlmAdapter {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = {
        model: options.model,
        max_tokens: options.maxTokens ?? 16000,
        messages: toWire(request.messages, request.system)
      }
      if (request.tools.length > 0) {
        body.tools = request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
        body.tool_choice = 'auto'
      }
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await options.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: request.signal })
      } catch {
        throw new LlmError('network', 'network error') // 원인 예외에는 주소·헤더가 섞일 수 있어 붙이지 않는다.
      }
      if (!response.ok) throw new LlmError(statusToKind(response.status), `api status ${response.status}`)

      let data: {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        data = (await response.json()) as typeof data
      } catch {
        throw new LlmError('unknown', 'response was not json')
      }
      const choice = data.choices?.[0]
      if (!choice?.message) throw new LlmError('unknown', 'response had no message')

      const content: ContentBlock[] = []
      if (choice.message.content) content.push({ type: 'text', text: choice.message.content })
      for (const call of choice.message.tool_calls ?? []) {
        let input: unknown
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          input = { __invalidJson: true } // 세션이 잘못된 입력으로 처리해 모델에 오류를 돌려준다.
        }
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
      }
      return {
        content,
        stopReason: mapFinish(choice.finish_reason, (choice.message.tool_calls?.length ?? 0) > 0),
        usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 }
      }
    }
  }
}

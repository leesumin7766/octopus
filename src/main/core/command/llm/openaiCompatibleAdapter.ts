import type { ContentBlock, Message, StopReason } from '../../../../shared/command/types'
import { LlmError, statusToKind, type ChatRequest, type ChatResponse, type LlmAdapter } from './types'

/** 스트림 본문 읽기(진짜 fetch 의 Response.body 중 쓰는 부분) */
export interface BodyReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; body?: { getReader(): BodyReaderLike } | null }>

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

interface WireToolCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
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

/** 도구 호출 하나를 tool_use 블록으로(인자가 JSON 이 아니면 세션이 잘못된 입력으로 처리하게 표시) */
function toToolUse(id: string, name: string, args: string): ContentBlock {
  let input: unknown
  try {
    input = JSON.parse(args || '{}')
  } catch {
    input = { __invalidJson: true } // 세션이 잘못된 입력으로 처리해 모델에 오류를 돌려준다.
  }
  return { type: 'tool_use', id, name, input }
}

const textOnly = (partial: string): ChatResponse => ({
  content: partial === '' ? [] : [{ type: 'text', text: partial }],
  stopReason: 'other',
  usage: { inputTokens: 0, outputTokens: 0 },
  aborted: true
})

/**
 * SSE 본문을 읽어 한 줄(data: …)씩 돌려준다. 줄이 청크 경계에서 잘려도 다음 청크와 이어 붙인 뒤에 처리한다.
 * '[DONE]' 을 만나면 끝낸다.
 */
export async function* readSseData(reader: BodyReaderLike): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    if (done) buffer += decoder.decode()

    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      const data = sseDataOf(line)
      if (data === '[DONE]') return
      if (data !== null) yield data
      newline = buffer.indexOf('\n')
    }
    if (done) {
      // 마지막 줄에 줄바꿈이 없어도 읽는다.
      const data = sseDataOf(buffer.replace(/\r$/, ''))
      if (data !== null && data !== '[DONE]') yield data
      return
    }
  }
}

/** "data: …" 줄에서 데이터만. 주석(:)·빈 줄·다른 필드는 null. */
function sseDataOf(line: string): string | null {
  if (!line.startsWith('data:')) return null
  return line.slice(5).replace(/^ /, '')
}

export function createOpenAiCompatibleAdapter(options: OpenAiAdapterOptions): LlmAdapter {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`

  function request(chat: ChatRequest, stream: boolean): { headers: Record<string, string>; body: string } {
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 16000,
      messages: toWire(chat.messages, chat.system)
    }
    if (stream) body.stream = true
    if (chat.tools.length > 0) {
      body.tools = chat.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
      body.tool_choice = 'auto'
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`
    return { headers, body: JSON.stringify(body) }
  }

  /** 한 번에 받은 JSON 응답을 공통 모양으로 */
  async function fromJson(response: Awaited<ReturnType<FetchLike>>, onText?: (text: string) => void): Promise<ChatResponse> {
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
    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content })
      onText?.(choice.message.content) // 서버가 스트림으로 보내지 않았으면 통째로 한 번에 흘려보낸다.
    }
    for (const call of choice.message.tool_calls ?? []) content.push(toToolUse(call.id, call.function.name, call.function.arguments))
    return {
      content,
      stopReason: mapFinish(choice.finish_reason, (choice.message.tool_calls?.length ?? 0) > 0),
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 }
    }
  }

  async function fromStream(reader: BodyReaderLike, chat: ChatRequest, onText: (text: string) => void): Promise<ChatResponse> {
    let text = ''
    let finish: unknown
    const calls = new Map<number, { id: string; name: string; args: string }>()

    try {
      for await (const data of readSseData(reader)) {
        let event: { choices?: { delta?: { content?: string | null; tool_calls?: WireToolCall[] }; finish_reason?: string | null }[] }
        try {
          event = JSON.parse(data) as typeof event
        } catch {
          continue // 깨진 조각은 건너뛴다.
        }
        const choice = event.choices?.[0]
        if (!choice) continue
        const delta = choice.delta
        if (delta?.content) {
          text += delta.content
          onText(delta.content)
        }
        for (const piece of delta?.tool_calls ?? []) {
          const index = piece.index ?? 0
          const call = calls.get(index) ?? { id: '', name: '', args: '' }
          if (piece.id) call.id = piece.id
          if (piece.function?.name) call.name += piece.function.name
          if (piece.function?.arguments) call.args += piece.function.arguments
          calls.set(index, call)
        }
        if (choice.finish_reason) finish = choice.finish_reason
      }
    } catch (error) {
      if (chat.signal?.aborted || (error as { name?: string } | null)?.name === 'AbortError') return textOnly(text)
      throw new LlmError('network', 'network error') // 스트림 도중 끊긴 연결
    }
    // 읽기가 정상으로 끝났어도 그 사이에 멈추라는 요청이 왔으면 멈춘 것으로 본다(끝나지 않은 도구 호출은 버린다).
    if (chat.signal?.aborted) return textOnly(text)

    const content: ContentBlock[] = text === '' ? [] : [{ type: 'text', text }]
    const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call)
    for (const call of ordered) content.push(toToolUse(call.id, call.name, call.args))
    return { content, stopReason: mapFinish(finish, ordered.length > 0), usage: { inputTokens: 0, outputTokens: 0 } }
  }

  return {
    async chat(chat: ChatRequest): Promise<ChatResponse> {
      const streaming = chat.onText !== undefined
      if (chat.signal?.aborted) return textOnly('')
      const { headers, body } = request(chat, streaming)

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await options.fetch(url, { method: 'POST', headers, body, signal: chat.signal })
      } catch (error) {
        if (chat.signal?.aborted || (error as { name?: string } | null)?.name === 'AbortError') return textOnly('')
        throw new LlmError('network', 'network error') // 원인 예외에는 주소·헤더가 섞일 수 있어 붙이지 않는다.
      }
      if (!response.ok) throw new LlmError(statusToKind(response.status), `api status ${response.status}`)

      if (chat.onText && response.body) return fromStream(response.body.getReader(), chat, chat.onText)
      return fromJson(response, chat.onText)
    }
  }
}

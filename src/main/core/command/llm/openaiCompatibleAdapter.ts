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

/** 첫 응답(헤더)이 오기까지 기다리는 시간(ms). 본문을 JSON 으로 한 번에 받을 때는 끝까지의 시간이기도 하다. */
export const OPENAI_FIRST_RESPONSE_MS = 120_000
/** 스트림에서 마지막 조각 이후 아무것도 오지 않으면 끊는 시간(ms) */
export const OPENAI_IDLE_MS = 90_000

export interface OpenAiAdapterOptions {
  fetch: FetchLike
  /** 예: https://api.openai.com/v1 (끝의 / 는 있어도 없어도 됨) */
  baseUrl: string
  model: string
  /** 키가 필요 없는 로컬 서버면 빈 값 */
  apiKey: string
  maxTokens?: number
  /** 첫 응답까지의 제한(ms). 기본 OPENAI_FIRST_RESPONSE_MS */
  firstResponseMs?: number
  /** 스트림 무응답 제한(ms). 기본 OPENAI_IDLE_MS */
  idleMs?: number
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

const isAbortError = (error: unknown): boolean => (error as { name?: string } | null)?.name === 'AbortError'

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

/** 한 번의 요청 동안의 중지·무응답 상태 */
interface Watch {
  /** 사용자가 멈췄다 */
  userAborted(): boolean
  /** 서버가 한동안 아무것도 보내지 않아 우리가 끊었다 */
  stalled(): boolean
  /** 멈추면(사용자든 무응답이든) 거절되는 약속과 경주시킨다: fetch·reader 구현이 signal 을 보지 않아도 끝나게 한다. */
  race<T>(promise: Promise<T>): Promise<T>
  /** 이 시간(ms) 안에 다음 신호가 없으면 끊는다 */
  arm(ms: number): void
}

export function createOpenAiCompatibleAdapter(options: OpenAiAdapterOptions): LlmAdapter {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const firstResponseMs = options.firstResponseMs ?? OPENAI_FIRST_RESPONSE_MS
  const idleMs = options.idleMs ?? OPENAI_IDLE_MS

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
  async function fromJson(response: Awaited<ReturnType<FetchLike>>, watch: Watch, onText?: (text: string) => void): Promise<ChatResponse> {
    let data: {
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      data = (await watch.race(response.json())) as typeof data
    } catch (error) {
      if (watch.stalled() || watch.userAborted() || isAbortError(error)) throw error // 바깥에서 분류한다
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

  async function fromStream(reader: BodyReaderLike, chat: ChatRequest, watch: Watch, onText: (text: string) => void): Promise<ChatResponse> {
    let text = ''
    let finish: unknown
    const calls = new Map<number, { id: string; name: string; args: string }>()
    // 조각(바이트)이 올 때마다 무응답 시간을 다시 센다. 주석·keep-alive 줄도 "응답 중"으로 본다.
    const watched: BodyReaderLike = {
      async read() {
        const chunk = await watch.race(reader.read())
        watch.arm(idleMs)
        return chunk
      }
    }

    try {
      for await (const data of readSseData(watched)) {
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
      // 우리가 끊은 것(무응답)은 사용자의 중지가 아니다.
      if (watch.stalled() && !watch.userAborted()) throw new LlmError('no_response', 'stream stalled')
      if (watch.userAborted() || isAbortError(error)) return textOnly(text)
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

      // 사용자의 중지와 우리의 시간 제한을 한 컨트롤러로 모아 fetch 에 건넨다.
      const controller = new AbortController()
      const onUserAbort = (): void => controller.abort()
      chat.signal?.addEventListener('abort', onUserAbort, { once: true })
      let stalled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = (ms: number): void => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          stalled = true
          controller.abort()
        }, ms)
      }
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      })
      aborted.catch(() => undefined) // 아무도 기다리지 않을 때의 처리 안 된 거절을 막는다
      const watch: Watch = {
        userAborted: () => chat.signal?.aborted === true,
        stalled: () => stalled,
        race: (promise) => Promise.race([promise, aborted]),
        arm
      }

      arm(firstResponseMs)
      try {
        let response: Awaited<ReturnType<FetchLike>>
        try {
          response = await watch.race(options.fetch(url, { method: 'POST', headers, body, signal: controller.signal }))
        } catch (error) {
          if (stalled && !watch.userAborted()) throw new LlmError('no_response', 'no response')
          if (watch.userAborted() || isAbortError(error)) return textOnly('')
          throw new LlmError('network', 'network error') // 원인 예외에는 주소·헤더가 섞일 수 있어 붙이지 않는다.
        }
        if (!response.ok) throw new LlmError(statusToKind(response.status), `api status ${response.status}`)

        if (chat.onText && response.body) {
          arm(idleMs) // 첫 응답은 왔다: 이제부터는 조각 사이의 무응답을 센다.
          return await fromStream(response.body.getReader(), chat, watch, chat.onText)
        }
        return await fromJson(response, watch, chat.onText)
      } catch (error) {
        if (error instanceof LlmError) throw error
        if (stalled && !watch.userAborted()) throw new LlmError('no_response', 'no response')
        if (watch.userAborted() || isAbortError(error)) return textOnly('')
        throw new LlmError('unknown', 'unexpected error')
      } finally {
        clearTimeout(timer)
        chat.signal?.removeEventListener('abort', onUserAbort)
      }
    }
  }
}

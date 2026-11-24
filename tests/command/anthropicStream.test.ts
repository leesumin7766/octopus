import { describe, expect, it, vi } from 'vitest'
import {
  createAnthropicAdapter,
  FALLBACK_BETA,
  STREAMING_MAX_TOKENS,
  type AnthropicClientLike,
  type AnthropicResponse,
  type AnthropicStreamLike
} from '../../src/main/core/command/llm/anthropicAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'

// 진짜 SDK·네트워크는 쓰지 않는다. SDK 의 MessageStream 중 어댑터가 쓰는 부분(on('text'), finalMessage, abort)만 흉내 낸다.

interface FakeStreamOptions {
  /** on('text') 로 흘려보낼 조각 */
  pieces?: string[]
  /** finalMessage() 가 돌려줄 완성 메시지 */
  final?: AnthropicResponse
  /** 조각을 흘려보낸 뒤 finalMessage() 가 던질 예외 */
  error?: Error
  /** 조각을 흘려보낸 뒤 signal 이 멈출 때까지 기다린다(그리고 APIUserAbortError 로 끝난다). */
  waitForAbort?: boolean
}

function fakeStream(options: FakeStreamOptions, signal?: AbortSignal): AnthropicStreamLike {
  let listener: ((delta: string, snapshot: string) => void) | undefined
  let started = false
  const run = async (): Promise<AnthropicResponse> => {
    if (started) throw new Error('finalMessage called twice')
    started = true
    let snapshot = ''
    for (const piece of options.pieces ?? []) {
      snapshot += piece
      listener?.(piece, snapshot)
      await Promise.resolve()
    }
    if (options.waitForAbort) {
      await new Promise<void>((resolve) => (signal?.aborted ? resolve() : signal?.addEventListener('abort', () => resolve())))
      throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })
    }
    if (options.error) throw options.error
    return options.final ?? { content: [], stop_reason: 'end_turn' }
  }
  return {
    on(_event, l) {
      listener = l
      return undefined
    },
    finalMessage: run,
    abort: vi.fn()
  }
}

function streamClient(options: FakeStreamOptions) {
  const beta = vi.fn((_params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => fakeStream(options, opts?.signal))
  const plain = vi.fn((_params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => fakeStream(options, opts?.signal))
  const create = vi.fn()
  const client = { messages: { create, stream: plain }, beta: { messages: { create, stream: beta } } } as unknown as AnthropicClientLike
  return { client, beta, plain, create }
}

const base = {
  system: 'sys',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
  tools: [{ name: 'list_tasks', description: 'd', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }]
}

describe('anthropic adapter: streaming', () => {
  it('streams text pieces to onText in order and returns the SDK\'s finished message in the usual shape', async () => {
    const f = streamClient({
      pieces: ['안', '녕', '하세요'],
      final: { content: [{ type: 'text', text: '안녕하세요' }], stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 3 } }
    })
    const seen: string[] = []

    const r = await createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5' }).chat({ ...base, onText: (text) => seen.push(text) })

    expect(seen).toEqual(['안', '녕', '하세요'])
    expect(r).toEqual({ content: [{ type: 'text', text: '안녕하세요' }], stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 3 } })
    expect(f.create).not.toHaveBeenCalled() // 한 번에 받는 호출은 쓰지 않는다
  })

  it('uses the stream with the same parameters (fallbacks beta, strict tools), a 64000 max_tokens default and the abort signal', async () => {
    const f = streamClient({ final: { content: [], stop_reason: 'end_turn' } })
    const controller = new AbortController()

    await createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5', effort: 'medium' }).chat({ ...base, signal: controller.signal, onText: () => undefined })

    const [params, options] = f.beta.mock.calls[0]
    expect(params).toMatchObject({ model: 'claude-opus-5-5', system: 'sys', max_tokens: STREAMING_MAX_TOKENS, output_config: { effort: 'medium' }, tool_choice: { type: 'auto' }, betas: [FALLBACK_BETA], fallbacks: 'default' })
    expect(STREAMING_MAX_TOKENS).toBe(64000)
    expect(options?.signal).toBe(controller.signal)
  })

  it('keeps strict tool validation: tool definitions never ask for eager input streaming', async () => {
    const f = streamClient({ final: { content: [], stop_reason: 'end_turn' } })

    await createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5' }).chat({ ...base, onText: () => undefined })

    const tool = (f.beta.mock.calls[0][0].tools as Record<string, unknown>[])[0]
    expect(tool).toMatchObject({ name: 'list_tasks', strict: true })
    expect('eager_input_streaming' in tool).toBe(false)
  })

  it('an explicit maxTokens wins, Haiku 5.5 streams without fallbacks, and fallbacks can be turned off', async () => {
    const custom = streamClient({ final: { content: [], stop_reason: 'end_turn' } })
    await createAnthropicAdapter({ client: custom.client, model: 'claude-opus-5-5', maxTokens: 1234 }).chat({ ...base, onText: () => undefined })
    expect(custom.beta.mock.calls[0][0].max_tokens).toBe(1234)

    const haiku = streamClient({ final: { content: [], stop_reason: 'end_turn' } })
    await createAnthropicAdapter({ client: haiku.client, model: 'claude-haiku-5-5' }).chat({ ...base, onText: () => undefined })
    expect(haiku.beta).not.toHaveBeenCalled()
    expect('fallbacks' in haiku.plain.mock.calls[0][0]).toBe(false)

    const off = streamClient({ final: { content: [], stop_reason: 'end_turn' } })
    await createAnthropicAdapter({ client: off.client, model: 'claude-opus-5-5', fallbacks: false }).chat({ ...base, onText: () => undefined })
    expect(off.beta).not.toHaveBeenCalled()
    expect(off.plain).toHaveBeenCalledTimes(1)
  })

  it('without onText it still takes the plain (non-streaming) path with 16000 tokens', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' }) as AnthropicResponse)
    const stream = vi.fn()
    const client = { messages: { create, stream }, beta: { messages: { create, stream } } } as unknown as AnthropicClientLike

    await createAnthropicAdapter({ client, model: 'claude-opus-5-5' }).chat(base)

    expect(stream).not.toHaveBeenCalled()
    expect((create.mock.calls[0] as unknown as [Record<string, unknown>])[0].max_tokens).toBe(16000)
  })

  it('text followed by a tool call: the finished message keeps both blocks, and the tool call is not streamed as text', async () => {
    const f = streamClient({
      pieces: ['확인할게요.'],
      final: {
        content: [
          { type: 'text', text: '확인할게요.' },
          { type: 'tool_use', id: 'tu_1', name: 'list_tasks', input: { view: 'today' } }
        ],
        stop_reason: 'tool_use'
      }
    })
    const seen: string[] = []

    const r = await createAnthropicAdapter({ client: f.client, model: 'm' }).chat({ ...base, onText: (text) => seen.push(text) })

    expect(seen).toEqual(['확인할게요.'])
    expect(r.stopReason).toBe('tool_use')
    expect(r.content).toEqual([
      { type: 'text', text: '확인할게요.' },
      { type: 'tool_use', id: 'tu_1', name: 'list_tasks', input: { view: 'today' } }
    ])
  })

  it('a refusal at the end of the stream is reported as stop reason refusal, and unknown blocks (fallback) are kept unchanged', async () => {
    const fallbackBlock = { type: 'fallback', from: 'claude-opus-5-5', to: 'claude-sonnet-5-5' }
    const f = streamClient({ pieces: ['잠깐만요'], final: { content: [fallbackBlock, { type: 'text', text: '잠깐만요' }], stop_reason: 'refusal' } })

    const r = await createAnthropicAdapter({ client: f.client, model: 'm' }).chat({ ...base, onText: () => undefined })

    expect(r.stopReason).toBe('refusal')
    expect(r.content[0]).toEqual({ type: 'opaque', provider: 'anthropic', raw: fallbackBlock })
  })

  it('abort: stops the stream and returns only the text received so far (no tool call), flagged aborted, without throwing', async () => {
    const controller = new AbortController()
    const f = streamClient({ pieces: ['반쯤 ', '쓴 답'], waitForAbort: true })
    const seen: string[] = []
    const promise = createAnthropicAdapter({ client: f.client, model: 'm' }).chat({ ...base, signal: controller.signal, onText: (text) => seen.push(text) })
    await vi.waitFor(() => expect(seen.join('')).toBe('반쯤 쓴 답'))

    controller.abort()
    const r = await promise

    expect(r.aborted).toBe(true)
    expect(r.content).toEqual([{ type: 'text', text: '반쯤 쓴 답' }])
  })

  it('abort before any text gives an empty answer, and an already-aborted signal never starts a stream', async () => {
    const controller = new AbortController()
    const f = streamClient({ waitForAbort: true })
    const first = createAnthropicAdapter({ client: f.client, model: 'm' }).chat({ ...base, signal: controller.signal, onText: () => undefined })
    controller.abort()
    expect(await first).toMatchObject({ aborted: true, content: [] })

    const again = streamClient({ final: { content: [], stop_reason: 'end_turn' } })
    const done = await createAnthropicAdapter({ client: again.client, model: 'm' }).chat({ ...base, signal: controller.signal, onText: () => undefined })
    expect(done).toMatchObject({ aborted: true, content: [] })
    expect(again.beta).not.toHaveBeenCalled()
  })

  it.each([
    ['a connection error in the middle of the stream', Object.assign(new Error('secret-key-sk-123'), { name: 'APIConnectionError' })],
    ['a connection timeout', Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' })],
    ['a dropped socket (TypeError: terminated)', new TypeError('terminated')],
    ['a reset connection code', Object.assign(new Error('read'), { code: 'ECONNRESET' })]
  ])('%s is a network error that does not leak the original message', async (_name, error) => {
    const f = streamClient({ pieces: ['절반'], error })
    const seen: string[] = []

    const thrown = await createAnthropicAdapter({ client: f.client, model: 'm' }).chat({ ...base, onText: (text) => seen.push(text) }).catch((e: unknown) => e)

    expect(seen).toEqual(['절반'])
    expect(thrown).toBeInstanceOf(LlmError)
    expect((thrown as LlmError).kind).toBe('network')
    expect((thrown as LlmError).message).not.toContain('secret-key')
  })

  it.each([
    [{ name: 'AuthenticationError', status: 401 }, 'auth'],
    [{ name: 'RateLimitError', status: 429 }, 'rate_limit'],
    [{ name: 'InternalServerError', status: 529 }, 'overloaded'],
    [{ name: 'BadRequestError', status: 400 }, 'bad_request'],
    [{ name: 'Error' }, 'unknown']
  ])('keeps the usual error mapping for streams: %j → %s', async (props, kind) => {
    const f = streamClient({ error: Object.assign(new Error('x'), props) })

    const thrown = await createAnthropicAdapter({ client: f.client, model: 'm' }).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)

    expect((thrown as LlmError).kind).toBe(kind)
  })

  it('an error thrown while starting the stream is classified the same way', async () => {
    const client = {
      messages: { create: vi.fn(), stream: vi.fn() },
      beta: {
        messages: {
          create: vi.fn(),
          stream: vi.fn(() => {
            throw Object.assign(new Error('x'), { name: 'AuthenticationError', status: 401 })
          })
        }
      }
    } as unknown as AnthropicClientLike

    const thrown = await createAnthropicAdapter({ client, model: 'm' }).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)

    expect((thrown as LlmError).kind).toBe('auth')
  })
})

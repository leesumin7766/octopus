import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAdapter, readSseData, type BodyReaderLike, type FetchLike } from '../../src/main/core/command/llm/openaiCompatibleAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'

// 진짜 네트워크는 쓰지 않는다. 가짜 fetch 가 SSE 본문을 청크 단위로 돌려준다.

const enc = new TextEncoder()
const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`
const delta = (d: Record<string, unknown>, finish: string | null = null): string => sse({ choices: [{ delta: d, finish_reason: finish }] })

/** 문자열(또는 바이트) 조각을 차례로 돌려주는 본문 읽기. error 가 있으면 조각이 끝난 뒤 그것을 던진다. */
function reader(chunks: (string | Uint8Array)[], error?: Error): BodyReaderLike {
  let i = 0
  return {
    async read() {
      if (i < chunks.length) {
        const chunk = chunks[i++]
        return { done: false, value: typeof chunk === 'string' ? enc.encode(chunk) : chunk }
      }
      if (error) throw error
      return { done: true }
    }
  }
}

function streamFetch(chunks: (string | Uint8Array)[], error?: Error) {
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), body: { getReader: () => reader(chunks, error) } }))
  return { fetch: fetch as unknown as FetchLike, mock: fetch }
}

const base = {
  system: 's',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
  tools: [{ name: 'list_tasks', description: 'd', inputSchema: { type: 'object', properties: {} } }]
}
const adapterFor = (fetch: FetchLike) => createOpenAiCompatibleAdapter({ fetch, baseUrl: 'http://localhost:1234/v1', model: 'm', apiKey: '' })

describe('openai-compatible adapter: streaming', () => {
  it('asks for a stream (stream: true) only when onText is given', async () => {
    const s = streamFetch([delta({ content: '안녕' }, 'stop'), 'data: [DONE]\n\n'])
    await adapterFor(s.fetch).chat({ ...base, onText: () => undefined })
    expect(JSON.parse((s.mock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ stream: true })

    const plain = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }) }))
    await adapterFor(plain as unknown as FetchLike).chat(base)
    expect('stream' in JSON.parse((plain.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toBe(false)
  })

  it('sends delta.content pieces to onText and returns the whole text; [DONE] ends it', async () => {
    const s = streamFetch([delta({ role: 'assistant' }), delta({ content: '오늘 ' }), delta({ content: '할 일은' }), delta({}, 'stop'), 'data: [DONE]\n\n', delta({ content: '버려져야 함' })])
    const seen: string[] = []

    const r = await adapterFor(s.fetch).chat({ ...base, onText: (text) => seen.push(text) })

    expect(seen).toEqual(['오늘 ', '할 일은'])
    expect(r.content).toEqual([{ type: 'text', text: '오늘 할 일은' }])
    expect(r.stopReason).toBe('end_turn')
  })

  it('lines cut at a chunk boundary (even in the middle of a JSON, a line break or a multi-byte letter) are joined before parsing', async () => {
    const whole = enc.encode(delta({ content: '한글' }) + delta({ content: '조각' }, 'stop') + 'data: [DONE]\n\n')
    // 아무 데서나 3바이트씩 자른다(한글 한 글자는 3바이트이므로 글자 중간에서도 잘린다).
    const chunks: Uint8Array[] = []
    for (let i = 0; i < whole.length; i += 3) chunks.push(whole.slice(i, i + 3))
    const seen: string[] = []

    const r = await adapterFor(streamFetch(chunks).fetch).chat({ ...base, onText: (text) => seen.push(text) })

    expect(seen.join('')).toBe('한글조각')
    expect(r.content).toEqual([{ type: 'text', text: '한글조각' }])
  })

  it('handles CRLF line breaks, comment lines and a last line without a final line break', async () => {
    const s = streamFetch([': keep-alive\r\n\r\n', `data: ${JSON.stringify({ choices: [{ delta: { content: 'A' } }] })}\r\n\r\n`, `data: ${JSON.stringify({ choices: [{ delta: { content: 'B' }, finish_reason: 'stop' }] })}`])

    const r = await adapterFor(s.fetch).chat({ ...base, onText: () => undefined })

    expect(r.content).toEqual([{ type: 'text', text: 'AB' }])
  })

  it('joins tool_calls pieces by index into finished tool_use blocks, in index order', async () => {
    const s = streamFetch([
      delta({ content: '확인할게요.' }),
      delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'list_', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'search_memos', arguments: '{"que' } }] }),
      delta({ tool_calls: [{ index: 0, function: { name: 'tasks', arguments: '{"view":' } }] }),
      delta({ tool_calls: [{ index: 1, function: { arguments: 'ry":"치과"}' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"today"}' } }] }),
      delta({}, 'tool_calls'),
      'data: [DONE]\n\n'
    ])
    const seen: string[] = []

    const r = await adapterFor(s.fetch).chat({ ...base, onText: (text) => seen.push(text) })

    expect(seen).toEqual(['확인할게요.']) // 도구 호출 조각은 글로 흘려보내지 않는다
    expect(r.stopReason).toBe('tool_use')
    expect(r.content).toEqual([
      { type: 'text', text: '확인할게요.' },
      { type: 'tool_use', id: 'call_a', name: 'list_tasks', input: { view: 'today' } },
      { type: 'tool_use', id: 'call_b', name: 'search_memos', input: { query: '치과' } }
    ])
  })

  it('arguments that are not JSON become an invalid-input marker (the session answers the model with an error)', async () => {
    const s = streamFetch([delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'list_tasks', arguments: '{"view":' } }] }, 'tool_calls'), 'data: [DONE]\n\n'])

    const r = await adapterFor(s.fetch).chat({ ...base, onText: () => undefined })

    expect(r.content).toEqual([{ type: 'tool_use', id: 'c', name: 'list_tasks', input: { __invalidJson: true } }])
  })

  it('skips broken data lines and maps finish reasons (length → max_tokens, content_filter → refusal)', async () => {
    const cut = await adapterFor(streamFetch(['data: {not json\n\n', delta({ content: 'a' }, 'length'), 'data: [DONE]\n\n']).fetch).chat({ ...base, onText: () => undefined })
    expect(cut.stopReason).toBe('max_tokens')
    expect(cut.content).toEqual([{ type: 'text', text: 'a' }])

    const blocked = await adapterFor(streamFetch([delta({ content: 'b' }, 'content_filter'), 'data: [DONE]\n\n']).fetch).chat({ ...base, onText: () => undefined })
    expect(blocked.stopReason).toBe('refusal')
  })

  it('abort in the middle: returns only the text so far (a half-built tool call is dropped), flagged aborted, no exception', async () => {
    const controller = new AbortController()
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    const s = streamFetch([delta({ content: '쓰던 ' }), delta({ content: '글' }), delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'list_tasks', arguments: '{"vi' } }] })], abortError)
    const seen: string[] = []

    const r = await adapterFor(s.fetch).chat({ ...base, signal: controller.signal, onText: (text) => seen.push(text) })

    expect(r.aborted).toBe(true)
    expect(r.content).toEqual([{ type: 'text', text: '쓰던 글' }])
    expect(seen.join('')).toBe('쓰던 글')
  })

  it('abort that arrives right as the stream ends still counts as stopped (the finished tool call is dropped)', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: {
        getReader: (): BodyReaderLike => {
          const inner = reader([delta({ content: 'x' }), delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'list_tasks', arguments: '{}' } }] }, 'tool_calls'), 'data: [DONE]\n\n'])
          return { read: async () => (controller.abort(), inner.read()) }
        }
      }
    }))

    const r = await adapterFor(fetch as unknown as FetchLike).chat({ ...base, signal: controller.signal, onText: () => undefined })

    expect(r.aborted).toBe(true)
    expect(r.content.some((b) => b.type === 'tool_use')).toBe(false)
  })

  it('an already-aborted signal does not call fetch, and an AbortError from fetch itself is a stop, not an error', async () => {
    const controller = new AbortController()
    controller.abort()
    const never = vi.fn()
    expect(await adapterFor(never as unknown as FetchLike).chat({ ...base, signal: controller.signal, onText: () => undefined })).toMatchObject({ aborted: true, content: [] })
    expect(never).not.toHaveBeenCalled()

    const live = new AbortController()
    const aborting = vi.fn(async () => {
      live.abort()
      throw Object.assign(new Error('x'), { name: 'AbortError' })
    })
    expect(await adapterFor(aborting as unknown as FetchLike).chat({ ...base, signal: live.signal, onText: () => undefined })).toMatchObject({ aborted: true })
  })

  it('a connection that drops in the middle of the stream is a network error without the original message', async () => {
    const s = streamFetch([delta({ content: '절반' })], new TypeError('terminated secret-key'))
    const seen: string[] = []

    const thrown = await adapterFor(s.fetch).chat({ ...base, onText: (text) => seen.push(text) }).catch((e: unknown) => e)

    expect(seen).toEqual(['절반'])
    expect(thrown).toBeInstanceOf(LlmError)
    expect((thrown as LlmError).kind).toBe('network')
    expect((thrown as LlmError).message).not.toContain('secret')
  })

  it('status errors before the stream starts keep the usual mapping', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    const thrown = await adapterFor(fetch as unknown as FetchLike).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)
    expect((thrown as LlmError).kind).toBe('rate_limit')
  })

  it('a server that ignores stream:true and answers with plain JSON still works (the text goes to onText once)', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '통째로' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) }))
    const seen: string[] = []

    const r = await adapterFor(fetch as unknown as FetchLike).chat({ ...base, onText: (text) => seen.push(text) })

    expect(seen).toEqual(['통째로'])
    expect(r).toMatchObject({ content: [{ type: 'text', text: '통째로' }], stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } })
  })
})

describe('readSseData', () => {
  it('yields each data line once, ignores everything else and stops at [DONE]', async () => {
    const lines: string[] = []
    for await (const line of readSseData(reader(['event: x\ndata: 1\n', '\ndata: 2\n\n: c\n\ndata: [DONE]\n\ndata: 3\n\n']))) lines.push(line)
    expect(lines).toEqual(['1', '2'])
  })
})

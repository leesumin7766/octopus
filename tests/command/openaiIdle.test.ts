import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAdapter, OPENAI_FIRST_RESPONSE_MS, OPENAI_IDLE_MS, type BodyReaderLike, type FetchLike } from '../../src/main/core/command/llm/openaiCompatibleAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'

// 진짜 네트워크는 쓰지 않는다. 가짜 fetch 와 가짜 시계(vi.useFakeTimers)로 "서버가 말이 없는 시간"을 흘려보낸다.

const enc = new TextEncoder()
const delta = (content: string, finish: string | null = null): string => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`

/** 시험이 첫 응답·조각·끝을 정하는 가짜 서버 */
function controllableServer() {
  let respond!: (r: { ok: boolean; status: number; json(): Promise<unknown>; body?: { getReader(): BodyReaderLike } | null }) => void
  const queue: ({ done: boolean; value?: Uint8Array } | Error)[] = []
  let waiting: ((r: { done: boolean; value?: Uint8Array }) => void) | undefined
  let waitingReject: ((e: Error) => void) | undefined
  let usedSignal: AbortSignal | undefined
  const reader: BodyReaderLike = {
    read: () =>
      new Promise((resolve, reject) => {
        const next = queue.shift()
        if (next instanceof Error) return reject(next)
        if (next) return resolve(next)
        waiting = resolve
        waitingReject = reject
      })
  }
  const fetch = vi.fn((_url: string, init: { signal?: AbortSignal }) => {
    usedSignal = init.signal
    return new Promise((resolve) => (respond = resolve as typeof respond))
  }) as unknown as FetchLike
  const handle = {
    /** 첫 응답(헤더)을 보낸다. 스트림 본문 */
    open: (): void => respond({ ok: true, status: 200, json: async () => ({}), body: { getReader: () => reader } }),
    /** JSON 본문이 끝내 안 오는 응답을 보낸다 */
    openJsonNeverEnding: (): void => respond({ ok: true, status: 200, json: () => new Promise(() => undefined), body: null }),
    chunk: (text: string): void => {
      const item = { done: false, value: enc.encode(text) }
      if (waiting) {
        const resolve = waiting
        waiting = undefined
        resolve(item)
      } else queue.push(item)
    },
    end: (): void => {
      const item = { done: true }
      if (waiting) {
        const resolve = waiting
        waiting = undefined
        resolve(item)
      } else queue.push(item)
    },
    fail: (error: Error): void => {
      if (waitingReject) {
        const reject = waitingReject
        waitingReject = undefined
        reject(error)
      } else queue.push(error)
    },
    get signal() {
      return usedSignal
    }
  }
  return { fetch, handle }
}

const base = { system: 's', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }], tools: [] }
const adapterFor = (fetch: FetchLike, extra: { firstResponseMs?: number; idleMs?: number } = {}) =>
  createOpenAiCompatibleAdapter({ fetch, baseUrl: 'http://localhost:1234/v1', model: 'm', apiKey: '', ...extra })

describe('openai-compatible adapter: no-response limits', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('the limits are 120 seconds to the first response and 90 seconds between pieces', () => {
    expect(OPENAI_FIRST_RESPONSE_MS).toBe(120_000)
    expect(OPENAI_IDLE_MS).toBe(90_000)
  })

  it('no first response within 120 seconds → no_response (and the request is cancelled)', async () => {
    const s = controllableServer()
    const caught = adapterFor(s.fetch).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(119_000)
    expect(s.handle.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)

    const error = await caught
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('no_response')
    expect(s.handle.signal?.aborted).toBe(true)
  })

  it('a first response that comes late (100 s) is fine; then 90 seconds of silence after the last piece → no_response, the text so far is not passed off as an answer', async () => {
    const s = controllableServer()
    const seen: string[] = []
    const caught = adapterFor(s.fetch).chat({ ...base, onText: (t) => seen.push(t) }).catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(100_000)
    s.handle.open()
    s.handle.chunk(delta('조금'))
    await vi.advanceTimersByTimeAsync(89_000)
    expect(s.handle.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)

    const error = await caught
    expect((error as LlmError).kind).toBe('no_response')
    expect(seen).toEqual(['조금'])
  })

  it('every piece (even a keep-alive comment line) starts the 90 seconds over, so a slow but alive stream finishes', async () => {
    const s = controllableServer()
    const seen: string[] = []
    const promise = adapterFor(s.fetch).chat({ ...base, onText: (t) => seen.push(t) })
    s.handle.open()

    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(80_000) // 합쳐서 8분이 넘어도
      s.handle.chunk(i % 2 === 0 ? delta(`${i} `) : ': keep-alive\n\n')
    }
    s.handle.chunk(delta('끝', 'stop'))
    s.handle.chunk('data: [DONE]\n\n')
    s.handle.end()

    const r = await promise
    expect(r.content).toEqual([{ type: 'text', text: '0 2 4 끝' }])
    expect(r.stopReason).toBe('end_turn')
    expect(s.handle.signal?.aborted).toBe(false)
  })

  it('custom limits are used', async () => {
    const first = controllableServer()
    const noFirst = adapterFor(first.fetch, { firstResponseMs: 2_000 }).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(2_500)
    expect(((await noFirst) as LlmError).kind).toBe('no_response')

    const idle = controllableServer()
    const noPiece = adapterFor(idle.fetch, { idleMs: 3_000 }).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)
    idle.handle.open()
    await vi.advanceTimersByTimeAsync(3_500)
    expect(((await noPiece) as LlmError).kind).toBe('no_response')
  })

  it('a stop by the user is a stop, not an error, and the text received so far stays', async () => {
    const s = controllableServer()
    const controller = new AbortController()
    const seen: string[] = []
    const promise = adapterFor(s.fetch).chat({ ...base, signal: controller.signal, onText: (t) => seen.push(t) })
    s.handle.open()
    s.handle.chunk(delta('반쯤 쓴 글'))
    await vi.waitFor(() => expect(seen).toEqual(['반쯤 쓴 글']))

    controller.abort()
    const r = await promise

    expect(r.aborted).toBe(true)
    expect(r.content).toEqual([{ type: 'text', text: '반쯤 쓴 글' }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a connection that drops is still a network error, not no_response', async () => {
    const s = controllableServer()
    const caught = adapterFor(s.fetch).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)
    s.handle.open()
    s.handle.chunk(delta('절반'))
    await vi.advanceTimersByTimeAsync(10)

    s.handle.fail(new TypeError('terminated'))

    expect(((await caught) as LlmError).kind).toBe('network')
  })

  it('without a stream (plain JSON answer) the first-response limit covers the whole body', async () => {
    const s = controllableServer()
    const caught = adapterFor(s.fetch).chat({ ...base }).catch((e: unknown) => e)
    s.handle.openJsonNeverEnding()

    await vi.advanceTimersByTimeAsync(121_000)

    expect(((await caught) as LlmError).kind).toBe('no_response')
  })

  it('leaves no timer behind after a normal finish or an error', async () => {
    const ok = controllableServer()
    const promise = adapterFor(ok.fetch).chat({ ...base, onText: () => undefined })
    ok.handle.open()
    ok.handle.chunk(delta('끝', 'stop'))
    ok.handle.chunk('data: [DONE]\n\n')
    await promise
    expect(vi.getTimerCount()).toBe(0)

    const bad = controllableServer()
    const failing = adapterFor(bad.fetch, { firstResponseMs: 1_000 }).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_500)
    await failing
    expect(vi.getTimerCount()).toBe(0)
  })
})

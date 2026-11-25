import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicAdapter, STREAM_IDLE_MS, type AnthropicClientLike } from '../../src/main/core/command/llm/anthropicAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'

// 진짜 SDK·네트워크는 쓰지 않는다. 가짜 시계(vi.useFakeTimers)로 "이벤트가 안 오는 시간"을 흘려보낸다.

type Listener = (...args: unknown[]) => void

/** 시험이 이벤트를 직접 보내고 끝내는 가짜 스트림. SDK 에 넘긴 signal 이 멈추면 APIUserAbortError 로 끝난다. */
function controllableClient() {
  const listeners = new Map<string, Listener[]>()
  let signal: AbortSignal | undefined
  let finish!: (value: unknown) => void
  const handle = {
    emit: (event: string, ...args: unknown[]): void => (listeners.get(event) ?? []).forEach((l) => l(...args)),
    finish: (response: unknown): void => finish(response),
    get signal() {
      return signal
    }
  }
  const stream = (_params: unknown, options?: { signal?: AbortSignal }) => {
    signal = options?.signal
    return {
      on(event: string, listener: Listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return undefined
      },
      finalMessage: () =>
        new Promise((resolve, reject) => {
          finish = resolve
          const rejectAbort = (): void => reject(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }))
          if (signal?.aborted) rejectAbort()
          else signal?.addEventListener('abort', rejectAbort, { once: true })
        }),
      abort: vi.fn()
    }
  }
  const client = { messages: { create: vi.fn(), stream: vi.fn(stream) }, beta: { messages: { create: vi.fn(), stream: vi.fn(stream) } } } as unknown as AnthropicClientLike
  return { client, handle }
}

const base = { system: 's', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }], tools: [] }
const done = { content: [{ type: 'text', text: '끝' }], stop_reason: 'end_turn' }

describe('anthropic adapter: stream idle limit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('the limit is 90 seconds by default', () => {
    expect(STREAM_IDLE_MS).toBe(90_000)
  })

  it('stops and reports no_response when nothing arrives for 90 seconds after the response headers', async () => {
    const f = controllableClient()
    const promise = createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5' }).chat({ ...base, onText: () => undefined })
    const caught = promise.catch((e: unknown) => e)
    f.handle.emit('connect')

    await vi.advanceTimersByTimeAsync(89_000)
    expect(f.handle.signal?.aborted).toBe(false) // 아직 기다린다
    await vi.advanceTimersByTimeAsync(1_500)

    const error = await caught
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('no_response')
    expect(f.handle.signal?.aborted).toBe(true) // 스트림을 끊었다
  })

  it('every stream event (text, thinking, ping …) starts the 90 seconds over, so a slow but alive stream is never cut', async () => {
    const f = controllableClient()
    const seen: string[] = []
    const promise = createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5' }).chat({ ...base, onText: (t) => seen.push(t) })
    f.handle.emit('connect')

    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(80_000) // 합쳐서 8분이 넘어도
      f.handle.emit('streamEvent')
      if (i === 2) f.handle.emit('text', '조각', '조각')
    }
    f.handle.finish(done)

    const r = await promise
    expect(r.content).toEqual([{ type: 'text', text: '끝' }])
    expect(seen).toEqual(['조각'])
    expect(f.handle.signal?.aborted).toBe(false)
  })

  it('does not count before the response headers (the SDK\'s own 120 second timeout covers that part)', async () => {
    const f = controllableClient()
    const promise = createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5' }).chat({ ...base, onText: () => undefined })

    await vi.advanceTimersByTimeAsync(200_000)
    expect(f.handle.signal?.aborted).toBe(false)

    f.handle.emit('connect')
    f.handle.finish(done)
    expect((await promise).stopReason).toBe('end_turn')
  })

  it('a custom limit is used, and a stop by the user is still a stop (not an error) even after the timer was running', async () => {
    const f = controllableClient()
    const controller = new AbortController()
    const promise = createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5', idleMs: 5_000 }).chat({ ...base, signal: controller.signal, onText: () => undefined })
    f.handle.emit('connect')
    f.handle.emit('text', '반쯤', '반쯤')
    await vi.advanceTimersByTimeAsync(4_000)

    controller.abort()
    const r = await promise

    expect(r.aborted).toBe(true)
    expect(r.content).toEqual([{ type: 'text', text: '반쯤' }]) // 받은 글은 남는다
    await vi.advanceTimersByTimeAsync(10_000) // 멈춘 뒤에는 타이머가 더 일하지 않는다
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind after a normal finish or an error', async () => {
    const ok = controllableClient()
    const promise = createAnthropicAdapter({ client: ok.client, model: 'claude-opus-5-5' }).chat({ ...base, onText: () => undefined })
    ok.handle.emit('connect')
    ok.handle.finish(done)
    await promise
    expect(vi.getTimerCount()).toBe(0)

    const bad = controllableClient()
    const failing = createAnthropicAdapter({ client: bad.client, model: 'claude-opus-5-5', idleMs: 1_000 }).chat({ ...base, onText: () => undefined }).catch((e: unknown) => e)
    bad.handle.emit('connect')
    await vi.advanceTimersByTimeAsync(1_500)
    await failing
    expect(vi.getTimerCount()).toBe(0)
  })
})

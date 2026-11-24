import { describe, expect, it, vi } from 'vitest'
import type { KeyStore } from '../../src/main/core/command/adapterResolver'
import { createCommandHandlers, registerCommandHandlers, senderEmitter } from '../../src/main/ipc/command'
import type { IpcMainLike } from '../../src/main/ipc/result'
import { SecureStoreError } from '../../src/main/platform/secureStore'
import { DEFAULT_MODELS, type LlmProvider } from '../../src/shared/command/types'
import { IPC } from '../../src/shared/ipc'
import { createEnv, reply, text, use } from '../command/helpers'

function setup(opts: { keys?: Partial<Record<LlmProvider, string>>; keyStoreError?: boolean } = {}) {
  const e = createEnv([reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use'), reply([text('추가했어요')])])
  const data = { ...opts.keys }
  const keys: KeyStore = {
    get: (p) => {
      if (opts.keyStoreError) throw new SecureStoreError('unavailable', 'x')
      return data[p]
    },
    set: (p, k) => {
      if (opts.keyStoreError) throw new SecureStoreError('unavailable', 'x')
      data[p] = k
    },
    delete: (p) => void delete data[p]
  }
  const logged: unknown[] = []
  const handlers = createCommandHandlers({
    getSession: () => e.session,
    getRepository: () => e.conv,
    getModels: () => DEFAULT_MODELS.map((m) => ({ ...m })),
    keys,
    logError: (_c, error) => logged.push(error)
  })
  return { e, handlers, data, logged }
}

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

describe('command IPC handlers', () => {
  it('models: lists models and whether a key exists, never the key itself', () => {
    const { handlers, e } = setup({ keys: { anthropic: 'sk-SECRET' } })
    const r = handlers.models()
    expect(r).toMatchObject({ ok: true, data: { hasKey: { anthropic: true, 'openai-compatible': false } } })
    expect(JSON.stringify(r)).not.toContain('SECRET')
    e.t.db.close()
  })

  it('setKey stores the key and answers with null only; clearKey removes it', () => {
    const { handlers, data, e } = setup()
    expect(handlers.setKey('anthropic', '  sk-new  ')).toEqual({ ok: true, data: null })
    expect(data.anthropic).toBe('sk-new')
    expect(handlers.clearKey('anthropic')).toEqual({ ok: true, data: null })
    expect(data.anthropic).toBeUndefined()
    e.t.db.close()
  })

  it('refuses a bad provider or key, and says secure_unavailable when it cannot encrypt', () => {
    const { handlers, e } = setup()
    expect(handlers.setKey('other', 'k')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['provider'] } })
    expect(handlers.setKey('anthropic', '')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['key'] } })
    expect(handlers.setKey('anthropic', 'x'.repeat(501))).toMatchObject({ ok: false })
    expect(handlers.clearKey(5)).toMatchObject({ ok: false })
    e.t.db.close()

    const broken = setup({ keyStoreError: true })
    expect(broken.handlers.setKey('anthropic', 'k')).toEqual({ ok: false, error: { code: 'secure_unavailable' } })
    expect(broken.handlers.models()).toMatchObject({ ok: true, data: { hasKey: { anthropic: false } } }) // 못 읽어도 화면은 뜬다
    broken.e.t.db.close()
  })

  it('send validates its input strictly', async () => {
    const { handlers, e } = setup()
    for (const bad of [null, 'hi', {}, { conversationId: null, modelId: 'm' }, { conversationId: null, modelId: 'm', text: ' ' }, { conversationId: 'x', modelId: 'm', text: 't' }, { conversationId: null, modelId: 'm', text: 't', extra: 1 }, { conversationId: null, modelId: 'm', text: 'x'.repeat(8001) }]) {
      expect(await handlers.send(bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    }
    expect(e.adapter.requests).toHaveLength(0)
    e.t.db.close()
  })

  it('send → awaiting approval (nothing written) → decide(approve) writes and finishes', async () => {
    const { handlers, e } = setup()
    const sent = await handlers.send({ conversationId: null, modelId: 'm', text: '내일 치과 추가해' })
    if (!sent.ok) throw new Error('send failed')

    expect(sent.data.status).toBe('awaiting_approval')
    expect(e.t.repo.listView('upcoming', '2026-03-10')).toHaveLength(0)
    expect(handlers.pending(sent.data.conversationId)).toMatchObject({ ok: true, data: [{ callId: 'w', toolName: 'add_task' }] })

    const done = await handlers.decide(sent.data.conversationId, [{ callId: 'w', approve: true }])
    expect(done).toMatchObject({ ok: true, data: { status: 'done' } })
    expect(e.t.repo.listView('upcoming', '2026-03-10').map((t) => t.title)).toEqual(['치과'])
    e.t.db.close()
  })

  it('decide validates ids and decision shapes', async () => {
    const { handlers, e } = setup()
    expect(await handlers.decide('nope', [])).toMatchObject({ ok: false, error: { fields: ['id'] } })
    expect(await handlers.decide(ID, [{ callId: 'a', approve: 'yes' }])).toMatchObject({ ok: false, error: { fields: ['decisions'] } })
    expect(await handlers.decide(ID, 'all')).toMatchObject({ ok: false })
    expect(await handlers.decide(ID, [])).toMatchObject({ ok: true, data: { status: 'done', items: [] } }) // 기다리는 게 없으면 아무 일도 없다
    e.t.db.close()
  })

  it('an unknown conversation is not_found; conversations, transcript and remove work', async () => {
    const { handlers, e } = setup()
    expect(await handlers.send({ conversationId: ID, modelId: 'm', text: 't' })).toEqual({ ok: false, error: { code: 'not_found' } })

    const sent = await handlers.send({ conversationId: null, modelId: 'm', text: '추가' })
    if (!sent.ok) throw new Error('send failed')
    expect(handlers.conversations()).toMatchObject({ ok: true, data: [{ id: sent.data.conversationId }] })
    expect(handlers.transcript(sent.data.conversationId)).toMatchObject({ ok: true, data: [{ kind: 'user', text: '추가' }] })
    expect(handlers.removeConversation(sent.data.conversationId)).toEqual({ ok: true, data: null })
    expect(handlers.conversations()).toEqual({ ok: true, data: [] })
    e.t.db.close()
  })

  it('without a database every data channel says db_unavailable', async () => {
    const handlers = createCommandHandlers({ getSession: () => null, getRepository: () => null, getModels: () => [], keys: { get: () => undefined, set: () => undefined, delete: () => undefined }, logError: () => undefined })
    expect(await handlers.send({ conversationId: null, modelId: 'm', text: 't' })).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    expect(handlers.conversations()).toEqual({ ok: false, error: { code: 'db_unavailable' } })
  })

  it('registers exactly the command channels', () => {
    const { handlers, e } = setup()
    const handle = vi.fn()
    registerCommandHandlers({ handle } as IpcMainLike, handlers)
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual(
      [IPC.commandModels, IPC.commandSetKey, IPC.commandClearKey, IPC.commandSend, IPC.commandDecide, IPC.commandPending, IPC.commandConversations, IPC.commandTranscript, IPC.commandRemoveConversation, IPC.commandCancel].sort()
    )
    // 진행 이벤트 채널은 invoke 로 받는 채널이 아니다(main → renderer 로 밀어 주는 쪽).
    expect(handle.mock.calls.some((c) => c[0] === IPC.commandEvent)).toBe(false)
    e.t.db.close()
  })

  describe('progress events and cancel', () => {
    /** 가짜 창(webContents). send 로 받은 것을 모은다. */
    const fakeWindow = (destroyed = false) => ({ send: vi.fn(), isDestroyed: () => destroyed })

    function registered() {
      const s = setup()
      const channels = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
      registerCommandHandlers({ handle: (channel, listener) => void channels.set(channel, listener) }, s.handlers)
      return { ...s, call: (channel: string, event: unknown, ...args: unknown[]) => channels.get(channel)?.(event, ...args) }
    }

    it('senderEmitter pushes events on the command:event channel to that window only', () => {
      const a = fakeWindow()
      const b = fakeWindow()
      const emit = senderEmitter({ sender: a })

      emit?.({ conversationId: ID, kind: 'text', text: '안녕' })

      expect(a.send).toHaveBeenCalledWith(IPC.commandEvent, { conversationId: ID, kind: 'text', text: '안녕' })
      expect(b.send).not.toHaveBeenCalled()
    })

    it('senderEmitter does nothing for a closed window, and is undefined when the sender is unknown', () => {
      const closed = fakeWindow(true)
      senderEmitter({ sender: closed })?.({ conversationId: ID, kind: 'done' })
      expect(closed.send).not.toHaveBeenCalled()

      expect(senderEmitter(undefined)).toBeUndefined()
      expect(senderEmitter({})).toBeUndefined()
      expect(senderEmitter({ sender: {} })).toBeUndefined()
    })

    it('command:send streams its events to the window that sent it, not to another window', async () => {
      const r = registered()
      const mine = fakeWindow()
      const other = fakeWindow()

      const sent = await r.call(IPC.commandSend, { sender: mine }, { conversationId: null, modelId: 'm', text: '내일 치과 추가해' })

      expect(sent).toMatchObject({ ok: true, data: { status: 'awaiting_approval' } }) // 최종 결과는 반환값으로 그대로
      expect(mine.send.mock.calls.map((c) => (c[1] as { kind: string }).kind)).toEqual(['approval'])
      expect(mine.send.mock.calls.every((c) => c[0] === IPC.commandEvent)).toBe(true)
      expect(other.send).not.toHaveBeenCalled()
      r.e.t.db.close()
    })

    it('command:decide streams to its own window too', async () => {
      const r = registered()
      const first = (await r.call(IPC.commandSend, { sender: fakeWindow() }, { conversationId: null, modelId: 'm', text: '추가' })) as { data: { conversationId: string } }
      const mine = fakeWindow()

      await r.call(IPC.commandDecide, { sender: mine }, first.data.conversationId, [{ callId: 'w', approve: true }])

      expect(mine.send.mock.calls.map((c) => (c[1] as { kind: string }).kind)).toContain('done')
      r.e.t.db.close()
    })

    it('a send from an event without a window still returns its result (events are optional)', async () => {
      const r = registered()
      const sent = await r.call(IPC.commandSend, undefined, { conversationId: null, modelId: 'm', text: '추가' })
      expect(sent).toMatchObject({ ok: true })
      r.e.t.db.close()
    })

    it('cancel validates its target: a conversation id or null, nothing else', async () => {
      const { handlers, e } = setup()
      for (const bad of [undefined, 'nope', 5, {}, [], '']) {
        expect(await handlers.cancel(bad)).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['conversationId'] } })
      }
      expect(await handlers.cancel(null)).toEqual({ ok: true, data: null })
      expect(await handlers.cancel(ID)).toEqual({ ok: true, data: null })
      e.t.db.close()
    })

    it('cancel closes an approval that is waiting (like a rejection) and says so on the window', async () => {
      const r = registered()
      const mine = fakeWindow()
      const sent = (await r.call(IPC.commandSend, { sender: mine }, { conversationId: null, modelId: 'm', text: '추가' })) as { data: { conversationId: string } }

      const result = await r.call(IPC.commandCancel, { sender: fakeWindow() }, sent.data.conversationId)

      expect(result).toEqual({ ok: true, data: null })
      expect(r.handlers.pending(sent.data.conversationId)).toEqual({ ok: true, data: [] })
      expect(mine.send.mock.calls.map((c) => c[1])).toContainEqual({ conversationId: sent.data.conversationId, kind: 'done', canceled: true })
      r.e.t.db.close()
    })

    describe('a window that is closed', () => {
      /** 닫을 수 있는 가짜 창(webContents): 'destroyed' 로 한 번 알려 준다. */
      function closableWindow() {
        const destroyedListeners: (() => void)[] = []
        let destroyed = false
        return {
          send: vi.fn(),
          isDestroyed: () => destroyed,
          once: vi.fn((_event: string, listener: () => void) => void destroyedListeners.push(listener)),
          close(): void {
            destroyed = true
            destroyedListeners.splice(0).forEach((listener) => listener())
          }
        }
      }

      /** 요청마다 글을 조금 흘리고, 멈추라는 신호나 release() 가 올 때까지 기다리는 가짜 모델 */
      function waitingModel() {
        let release!: () => void
        const gate = new Promise<void>((resolve) => (release = resolve))
        const started: string[] = []
        const adapter = {
          async chat(request: { signal?: AbortSignal; onText?: (t: string) => void }) {
            started.push('request')
            request.onText?.('쓰는 중')
            await new Promise<void>((resolve) => {
              void gate.then(resolve)
              if (request.signal?.aborted) resolve()
              else request.signal?.addEventListener('abort', () => resolve())
            })
            const aborted = request.signal?.aborted === true
            return { content: [{ type: 'text' as const, text: '쓰는 중' }], stopReason: 'end_turn' as const, usage: { inputTokens: 0, outputTokens: 0 }, ...(aborted ? { aborted: true } : {}) }
          }
        }
        return { adapter, release, started }
      }

      function wired(model: ReturnType<typeof waitingModel>) {
        const e = createEnv([], [], undefined, model.adapter as never)
        const channels = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
        const handlers = createCommandHandlers({
          getSession: () => e.session,
          getRepository: () => e.conv,
          getModels: () => DEFAULT_MODELS.map((m) => ({ ...m })),
          keys: { get: () => undefined, set: () => undefined, delete: () => undefined },
          logError: () => undefined
        })
        registerCommandHandlers({ handle: (channel, listener) => void channels.set(channel, listener) }, handlers)
        const send = (window: unknown) => channels.get(IPC.commandSend)?.({ sender: window }, { conversationId: null, modelId: 'm', text: '지시' }) as Promise<{ ok: boolean; data: { status: string; items: { kind: string; text?: string }[] } }>
        return { e, send }
      }

      it('closing a window stops the request that window sent, and only that one', async () => {
        const model = waitingModel()
        const { e, send } = wired(model)
        const a = closableWindow()
        const b = closableWindow()
        const sentA = send(a)
        const sentB = send(b)
        await vi.waitFor(() => expect(model.started).toHaveLength(2))

        a.close()
        const resultA = await sentA

        expect(resultA.data.items[resultA.data.items.length - 1]).toMatchObject({ kind: 'assistant', text: '쓰는 중\n\n(중지됨)' })
        let bDone = false
        void sentB.then(() => (bDone = true))
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(bDone).toBe(false) // 다른 창의 요청은 계속 돈다

        model.release()
        expect((await sentB).data.status).toBe('done')
        e.t.db.close()
      })

      it('watches each window only once, however many requests it sends', async () => {
        const model = waitingModel()
        const { e, send } = wired(model)
        const win = closableWindow()
        model.release() // 기다리지 않고 바로 끝나게

        await send(win)
        await send(win)
        await send(win)

        expect(win.once).toHaveBeenCalledTimes(1)
        expect(win.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
        e.t.db.close()
      })

      it('no more events are pushed to a window that is gone', async () => {
        const model = waitingModel()
        const { e, send } = wired(model)
        const win = closableWindow()
        const sent = send(win)
        await vi.waitFor(() => expect(win.send).toHaveBeenCalled())

        win.close()
        await sent
        const afterClose = win.send.mock.calls.length
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(win.send.mock.calls.length).toBe(afterClose)
        expect(win.send.mock.calls.every((c) => c[0] === IPC.commandEvent)).toBe(true)
        e.t.db.close()
      })

      it('closing a window with nothing running is harmless, and a sender that cannot be watched still works', async () => {
        const model = waitingModel()
        const { e, send } = wired(model)
        const idle = closableWindow()
        const first = send(idle)
        model.release()
        await first

        expect(() => idle.close()).not.toThrow()

        // once 가 없는 보낸 쪽(예: 시험용 객체)도 요청은 된다.
        expect((await send({ send: vi.fn(), isDestroyed: () => false })).ok).toBe(true)
        e.t.db.close()
      })
    })

    it('cancel without a database says db_unavailable', async () => {
      const handlers = createCommandHandlers({ getSession: () => null, getRepository: () => null, getModels: () => [], keys: { get: () => undefined, set: () => undefined, delete: () => undefined }, logError: () => undefined })
      expect(await handlers.cancel(null)).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    })
  })
})

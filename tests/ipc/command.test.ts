import { describe, expect, it, vi } from 'vitest'
import type { KeyStore } from '../../src/main/core/command/adapterResolver'
import { createCommandHandlers, registerCommandHandlers } from '../../src/main/ipc/command'
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
      [IPC.commandModels, IPC.commandSetKey, IPC.commandClearKey, IPC.commandSend, IPC.commandDecide, IPC.commandPending, IPC.commandConversations, IPC.commandTranscript, IPC.commandRemoveConversation].sort()
    )
    e.t.db.close()
  })
})

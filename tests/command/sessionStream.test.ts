import { describe, expect, it, vi } from 'vitest'
import type { ChatRequest, ChatResponse, LlmAdapter } from '../../src/main/core/command/llm/types'
import { LlmError } from '../../src/main/core/command/llm/types'
import type { CommandEvent } from '../../src/shared/command/types'
import { createEnv, reply, text, use } from './helpers'

// 진짜 모델·네트워크는 쓰지 않는다. 글 조각을 흘려보내는 가짜 모델로 세션의 진행 이벤트와 중지를 본다.

interface StreamStep {
  /** onText 로 흘려보낼 조각 */
  pieces?: string[]
  /** 끝낼 때 돌려줄 응답(없으면 조각을 이어 붙인 글) */
  response?: ChatResponse
  /** 조각을 보낸 뒤 던질 오류 */
  error?: LlmError
  /** 조각을 보낸 뒤 signal 이 멈출 때까지 기다리다가, 그때까지의 글만 aborted 로 돌려준다(진짜 어댑터처럼). */
  waitForAbort?: boolean
  /** 조각을 보낸 뒤 이것이 풀릴 때까지 기다렸다가 response 를 돌려준다(어댑터는 멈춤을 모르는 채 끝나는 경우). */
  gate?: Promise<void>
}

function streaming(steps: StreamStep[]): LlmAdapter & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  let i = 0
  return {
    requests,
    async chat(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as ChatRequest)
      const step = steps[Math.min(i++, steps.length - 1)]
      let got = ''
      for (const piece of step.pieces ?? []) {
        got += piece
        request.onText?.(piece)
        await Promise.resolve()
      }
      if (step.waitForAbort) {
        await new Promise<void>((resolve) => (request.signal?.aborted ? resolve() : request.signal?.addEventListener('abort', () => resolve())))
        return { content: got === '' ? [] : [text(got)], stopReason: 'other', usage: { inputTokens: 0, outputTokens: 0 }, aborted: true }
      }
      if (step.gate) await step.gate
      if (step.error) throw step.error
      return step.response ?? reply(got === '' ? [] : [text(got)])
    }
  }
}

const kinds = (events: CommandEvent[]): string[] => events.map((e) => e.kind)
const input = { conversationId: null, modelId: 'm', text: '오늘 할 일을 알려 줘' }

describe('command session: progress events', () => {
  it('sends text pieces in order, then done; the result still carries the whole answer', async () => {
    const e = createEnv([], [], undefined, streaming([{ pieces: ['오늘은 ', '할 일이 ', '없어요.'] }]))
    const events: CommandEvent[] = []

    const turn = await e.session.send(input, (ev) => events.push(ev))

    expect(kinds(events)).toEqual(['text', 'text', 'text', 'done'])
    expect(events.filter((ev) => ev.kind === 'text').map((ev) => (ev as { text: string }).text)).toEqual(['오늘은 ', '할 일이 ', '없어요.'])
    expect(events.every((ev) => ev.conversationId === turn.conversationId)).toBe(true)
    expect(turn).toMatchObject({ status: 'done', items: [{ kind: 'user' }, { kind: 'assistant', text: '오늘은 할 일이 없어요.' }] })
    e.t.db.close()
  })

  it('a read-only tool announces its name while it runs, then the next answer streams on', async () => {
    const e = createEnv(
      [],
      [],
      undefined,
      streaming([
        { pieces: ['확인할게요.'], response: reply([text('확인할게요.'), use('r1', 'list_tasks', { view: 'inbox' })], 'tool_use') },
        { pieces: ['비어 있어요.'] }
      ])
    )
    const events: CommandEvent[] = []

    const turn = await e.session.send(input, (ev) => events.push(ev))

    expect(kinds(events)).toEqual(['text', 'tool', 'text', 'done'])
    expect(events[1]).toMatchObject({ kind: 'tool', name: 'list_tasks' })
    expect(turn.status).toBe('done')
    e.t.db.close()
  })

  it('a write tool ends the turn with an approval event (the card itself is in the result)', async () => {
    const e = createEnv([reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use')])
    const events: CommandEvent[] = []

    const turn = await e.session.send(input, (ev) => events.push(ev))

    expect(kinds(events)).toEqual(['approval'])
    expect(turn.status).toBe('awaiting_approval')
    expect(turn.pending).toHaveLength(1)
    e.t.db.close()
  })

  it('decide also reports progress and ends with done', async () => {
    const e = createEnv([reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use')], [], undefined, streaming([{ response: reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use') }, { pieces: ['추가했어요.'] }]))
    const first = await e.session.send(input)
    const events: CommandEvent[] = []

    const turn = await e.session.decide(first.conversationId, [{ callId: 'w', approve: true }], (ev) => events.push(ev))

    expect(kinds(events)).toEqual(['text', 'done'])
    expect(turn.status).toBe('done')
    e.t.db.close()
  })

  it('an adapter failure ends with an error event and leaves the partial text out of the result', async () => {
    const e = createEnv([], [], undefined, streaming([{ pieces: ['절반'], error: new LlmError('network', 'network error') }]))
    const events: CommandEvent[] = []

    const turn = await e.session.send(input, (ev) => events.push(ev))

    expect(kinds(events)).toEqual(['text', 'error'])
    expect(events[1]).toMatchObject({ kind: 'error', error: 'network' })
    expect(turn).toMatchObject({ status: 'error', error: 'network', items: [{ kind: 'user' }] })
    e.t.db.close()
  })

  it('a refusal at the end sends replace (the text already shown is swapped for the notice) and keeps no partial text in the result', async () => {
    const e = createEnv([], [], undefined, streaming([{ pieces: ['부분 글'], response: reply([text('부분 글')], 'refusal') }]))
    const events: CommandEvent[] = []

    const turn = await e.session.send(input, (ev) => events.push(ev))

    expect(kinds(events)).toEqual(['text', 'replace', 'error'])
    expect(events[1]).toMatchObject({ kind: 'replace', reason: 'refusal' })
    expect(events[2]).toMatchObject({ kind: 'error', error: 'refusal' })
    expect(turn).toMatchObject({ status: 'error', error: 'refusal' })
    expect(turn.items.some((item) => item.kind === 'assistant')).toBe(false)
    e.t.db.close()
  })

  it('unknown blocks of a refused answer (fallback) are kept in the history and sent back on the next request', async () => {
    const fallback = { type: 'opaque' as const, provider: 'anthropic' as const, raw: { type: 'fallback', to: 'claude-sonnet-5-5' } }
    const adapter = streaming([{ response: reply([fallback], 'refusal') }, { pieces: ['네.'] }])
    const e = createEnv([], [], undefined, adapter)
    const first = await e.session.send(input)

    await e.session.send({ ...input, conversationId: first.conversationId, text: '다시' })

    const sent = adapter.requests[1].messages
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(sent[1].content).toEqual([fallback])
    e.t.db.close()
  })

  it('an event receiver that throws does not break the turn', async () => {
    const e = createEnv([], [], undefined, streaming([{ pieces: ['괜찮아요.'] }]))

    const turn = await e.session.send(input, () => {
      throw new Error('window is gone')
    })

    expect(turn.status).toBe('done')
    e.t.db.close()
  })

  it('works without any receiver (events are optional)', async () => {
    const e = createEnv([], [], undefined, streaming([{ pieces: ['혼자서도.'] }]))
    expect((await e.session.send(input)).status).toBe('done')
    e.t.db.close()
  })
})

describe('command session: cancel', () => {
  it('stops a streaming answer: only the received text is kept, marked "(중지됨)", and the next request is valid', async () => {
    const adapter = streaming([{ pieces: ['abc'], waitForAbort: true }, { pieces: ['이어서 답해요.'] }])
    const e = createEnv([], [], undefined, adapter)
    const events: CommandEvent[] = []
    const turnPromise = e.session.send(input, (ev) => events.push(ev))
    await vi.waitFor(() => expect(events.some((ev) => ev.kind === 'text')).toBe(true))
    const id = events[0].conversationId

    await e.session.cancel(id)
    const turn = await turnPromise

    expect(turn.status).toBe('done')
    expect(turn.items).toEqual([
      { kind: 'user', text: input.text },
      { kind: 'assistant', text: 'abc\n\n(중지됨)' }
    ])
    expect(events[events.length - 1]).toEqual({ conversationId: id, kind: 'done', canceled: true })
    expect(e.conv.messages(id).map((m) => m.role)).toEqual(['user', 'assistant'])

    await e.session.send({ ...input, conversationId: id, text: '다시 해 줘' })
    expect(adapter.requests[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(adapter.requests[1].messages)).toContain('(중지됨)')
    e.t.db.close()
  })

  it('stopping before any text is recorded as a bare "(중지됨)" answer', async () => {
    const e = createEnv([], [], undefined, streaming([{ waitForAbort: true }]))
    const events: CommandEvent[] = []
    const turnPromise = e.session.send(input, (ev) => events.push(ev))
    // 이벤트가 없어도 대화 id 를 모를 때는 null 로 모두 중지한다.
    await vi.waitFor(async () => {
      await e.session.cancel(null)
      expect(events.some((ev) => ev.kind === 'done')).toBe(true)
    })

    const turn = await turnPromise

    expect(turn.items[turn.items.length - 1]).toEqual({ kind: 'assistant', text: '(중지됨)' })
    expect(events[events.length - 1]).toMatchObject({ kind: 'done', canceled: true })
    e.t.db.close()
  })

  it('a tool call in an answer that finished just as it was stopped is not recorded and not run', async () => {
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    const adapter = streaming([{ pieces: ['찾아볼게요.'], gate, response: reply([text('찾아볼게요.'), use('w', 'add_task', { text: '내일 치과' })], 'tool_use') }])
    const e = createEnv([], [], undefined, adapter)
    const events: CommandEvent[] = []
    const turnPromise = e.session.send(input, (ev) => events.push(ev))
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))
    const id = events[0].conversationId

    await e.session.cancel(id)
    open()
    const turn = await turnPromise

    expect(turn.status).toBe('done')
    expect(turn.pending).toEqual([])
    expect(turn.items.some((item) => item.kind === 'tool')).toBe(false)
    const history = e.conv.messages(id)
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(history.flatMap((m) => m.content).some((b) => b.type === 'tool_use')).toBe(false) // 짝 없는 tool_use 가 남지 않는다
    expect(e.t.repo.listView('upcoming', '2026-03-10')).toEqual([]) // 도구는 실행되지 않았다
    e.t.db.close()
  })

  it('stopping while waiting for approval closes it like a rejection, and nothing is run', async () => {
    const e = createEnv([reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use'), reply([text('알겠어요')])])
    const events: CommandEvent[] = []
    const first = await e.session.send(input, (ev) => events.push(ev))
    expect(first.status).toBe('awaiting_approval')

    await e.session.cancel(first.conversationId)

    expect(e.session.pending(first.conversationId)).toEqual([])
    expect(events[events.length - 1]).toEqual({ conversationId: first.conversationId, kind: 'done', canceled: true })
    const last = e.conv.messages(first.conversationId).at(-1)
    expect(last?.role).toBe('user')
    expect(last?.content[0]).toMatchObject({ type: 'tool_result', isError: true })
    expect(e.t.repo.listView('upcoming', '2026-03-10')).toEqual([])
    // 이어서 말할 수 있다(기록이 어긋나지 않는다).
    expect((await e.session.send({ ...input, conversationId: first.conversationId, text: '다시' })).status).toBe('done')
    e.t.db.close()
  })

  it('stopping when nothing is running does nothing (and an unknown id is harmless)', async () => {
    const e = createEnv([reply([text('안녕')])])
    await expect(e.session.cancel(null)).resolves.toBeUndefined()
    await expect(e.session.cancel('01ARZ3NDEKTSV4RRFFQ69G5FAV')).resolves.toBeUndefined()
    expect((await e.session.send(input)).status).toBe('done') // 앞의 중지가 다음 요청에 남지 않는다
    e.t.db.close()
  })

  it('stopping during a decide also ends it cleanly', async () => {
    const adapter = streaming([{ response: reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use') }, { pieces: ['추가'], waitForAbort: true }])
    const e = createEnv([], [], undefined, adapter)
    const first = await e.session.send(input)
    const events: CommandEvent[] = []
    const decided = e.session.decide(first.conversationId, [{ callId: 'w', approve: true }], (ev) => events.push(ev))
    await vi.waitFor(() => expect(events.some((ev) => ev.kind === 'text')).toBe(true))

    await e.session.cancel(first.conversationId)
    const turn = await decided

    expect(turn.items[turn.items.length - 1]).toMatchObject({ kind: 'assistant', text: '추가\n\n(중지됨)' })
    expect(e.conv.messages(first.conversationId).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    e.t.db.close()
  })
})

describe('command session: cancelOwner (the window that sent the request was closed)', () => {
  it('stops only the running requests of that owner; another owner keeps running', async () => {
    let releaseB!: () => void
    const gateB = new Promise<void>((resolve) => (releaseB = resolve))
    const adapter = streaming([{ pieces: ['A 가 쓰는 중'], waitForAbort: true }, { pieces: ['B 가 쓰는 중'], gate: gateB }])
    const e = createEnv([], [], undefined, adapter)
    const windowA = { name: 'A' }
    const windowB = { name: 'B' }
    const eventsA: CommandEvent[] = []
    const eventsB: CommandEvent[] = []
    const a = e.session.send(input, (ev) => eventsA.push(ev), windowA)
    await vi.waitFor(() => expect(eventsA.length).toBeGreaterThan(0))
    const b = e.session.send(input, (ev) => eventsB.push(ev), windowB)
    await vi.waitFor(() => expect(eventsB.length).toBeGreaterThan(0))

    e.session.cancelOwner(windowA)

    const turnA = await a
    expect(turnA.items[turnA.items.length - 1]).toMatchObject({ kind: 'assistant', text: 'A 가 쓰는 중\n\n(중지됨)' })
    expect(eventsB.some((ev) => ev.kind === 'done')).toBe(false) // B 는 계속 돈다
    releaseB()
    const turnB = await b
    expect(turnB.status).toBe('done')
    expect(turnB.items[turnB.items.length - 1]).toMatchObject({ kind: 'assistant', text: 'B 가 쓰는 중' })
    e.t.db.close()
  })

  it('does nothing for an owner without a running request, and does not touch a request that has no owner', async () => {
    const adapter = streaming([{ pieces: ['주인 없는 요청'], waitForAbort: true }])
    const e = createEnv([], [], undefined, adapter)
    const events: CommandEvent[] = []
    const turn = e.session.send(input, (ev) => events.push(ev)) // owner 없음
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))

    e.session.cancelOwner({ name: 'nobody' })
    e.session.cancelOwner(undefined) // 주인을 모르는 값은 주인 없는 요청과 짝이 되지 않는다
    e.session.cancelOwner(null)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events.some((ev) => ev.kind === 'done')).toBe(false)
    await e.session.cancel(null)
    expect((await turn).status).toBe('done')
    e.t.db.close()
  })

  it('also stops a decide that is running for that owner, and leaves the history valid for the next message', async () => {
    const adapter = streaming([{ response: reply([use('w', 'add_task', { text: '내일 치과' })], 'tool_use') }, { pieces: ['추가하는 중'], waitForAbort: true }, { pieces: ['다시 답해요.'] }])
    const e = createEnv([], [], undefined, adapter)
    const owner = { name: 'window' }
    const first = await e.session.send(input, undefined, owner)
    const events: CommandEvent[] = []
    const decided = e.session.decide(first.conversationId, [{ callId: 'w', approve: true }], (ev) => events.push(ev), owner)
    await vi.waitFor(() => expect(events.some((ev) => ev.kind === 'text')).toBe(true))

    e.session.cancelOwner(owner)
    const turn = await decided

    expect(turn.items[turn.items.length - 1]).toMatchObject({ text: '추가하는 중\n\n(중지됨)' })
    expect((await e.session.send({ ...input, conversationId: first.conversationId, text: '다시' })).status).toBe('done')
    expect(adapter.requests[2].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    e.t.db.close()
  })
})

describe('command session: transcript after a stop', () => {
  it('the saved transcript shows the stopped answer with its marker', async () => {
    const e = createEnv([], [], undefined, streaming([{ pieces: ['반쯤'], waitForAbort: true }]))
    const events: CommandEvent[] = []
    const turnPromise = e.session.send(input, (ev) => events.push(ev))
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))
    const id = events[0].conversationId
    await e.session.cancel(id)
    await turnPromise

    expect(e.session.transcript(id)).toEqual([
      { kind: 'user', text: input.text },
      { kind: 'assistant', text: '반쯤\n\n(중지됨)' }
    ])
    e.t.db.close()
  })
})

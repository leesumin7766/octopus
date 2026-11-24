import type {
  CommandErrorKind,
  CommandEvent,
  ContentBlock,
  Message,
  PendingApproval,
  ToolSource,
  TranscriptItem,
  TurnState
} from '../../../shared/command/types'
import type { ConversationRepository } from './conversationRepository'
import { ConversationNotFoundError } from './conversationRepository'
import { LlmError, type LlmAdapter } from './llm/types'
import { SYSTEM_PROMPT, wrapToolResult } from './systemPrompt'
import type { CommandTool, ToolRegistry } from './tools/registry'

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>
type ToolResult = Extract<ContentBlock, { type: 'tool_result' }>
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** 진행 이벤트 한 개(대화 id 는 세션이 붙인다) */
export type EventBody = DistributiveOmit<CommandEvent, 'conversationId'>
/** 진행 이벤트를 받는 쪽(창으로 밀어 주는 함수). 표시용이라 던져도 세션은 영향을 받지 않는다. */
export type EmitEvent = (event: CommandEvent) => void

export interface SessionDeps {
  repo: ConversationRepository
  registry: ToolRegistry
  /** 모델 id 의 어댑터. 키가 없으면 LlmError('no_key'), 모르는 모델이면 LlmError('bad_request') */
  getAdapter(modelId: string): LlmAdapter
  /** 한 번의 지시에서 모델을 부르는 최대 횟수 */
  maxSteps?: number
}

export interface Decision {
  callId: string
  approve: boolean
}

export interface CommandSession {
  /**
   * 새 대화(conversationId=null)를 시작하거나 이어서 말한다. emit 이 있으면 진행 이벤트를 보낸다.
   * owner 는 요청을 보낸 창 같은 주인 표시로, cancelOwner 로 그 주인의 요청만 멈출 때 쓴다.
   */
  send(input: { conversationId: string | null; modelId: string; text: string }, emit?: EmitEvent, owner?: unknown): Promise<TurnState>
  /** 승인 대기 중인 쓰기 동작에 대한 결정. 빠진 항목은 거절로 본다. */
  decide(conversationId: string, decisions: readonly Decision[], emit?: EmitEvent, owner?: unknown): Promise<TurnState>
  /** 이 주인(창)이 보낸, 진행 중인 요청을 모두 중지한다(창이 닫힐 때). 승인 대기는 건드리지 않는다. */
  cancelOwner(owner: unknown): void
  /**
   * 진행 중인 요청을 중지한다(대화 id 가 null 이면 진행 중인 것을 모두). 승인 대기 중이면 거절과 같게 닫는다.
   * 중지된 턴의 결과는 그 요청을 부른 send/decide 가 돌려준다.
   */
  cancel(conversationId: string | null): Promise<void>
  /** 승인 대기 중인 것(앱을 다시 켜면 비어 있다). */
  pending(conversationId: string): PendingApproval[]
  transcript(conversationId: string): TranscriptItem[]
}

interface PendingCall {
  use: ToolUse
  tool: CommandTool
  input: unknown
  approval: PendingApproval
}

interface Waiting {
  modelId: string
  /** 모델이 부른 순서대로. 이미 결과가 난 것은 results 에 있다. */
  uses: ToolUse[]
  results: Map<string, ToolResult>
  calls: PendingCall[]
  /** 이 승인 대기를 만든 요청의 창으로 이벤트를 보내는 함수(중지로 닫을 때 쓴다) */
  emit: (event: EventBody) => void
}

/** 한 번의 요청(send/decide)이 진행되는 동안 쓰는 것 */
interface Run {
  signal: AbortSignal
  emit: (event: EventBody) => void
  /** 사용자가 중지해서 끝났다 */
  canceled: boolean
}

const REJECTED = '사용자가 이 동작을 거절했습니다. 같은 동작을 다시 시도하지 마세요.'
const CANCELED = '이 동작은 승인 전에 취소되었습니다.'
/** 중지된 턴의 대화 기록에 남기는 표시 */
const STOPPED = '(중지됨)'

const sourceOf = (tool: CommandTool): ToolSource => tool.source ?? 'core'
const summary = (text: string): string => (text.length > 200 ? text.slice(0, 200) + '…' : text)
const textOf = (content: readonly ContentBlock[]): string =>
  content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('')

export function createCommandSession(deps: SessionDeps): CommandSession {
  const maxSteps = deps.maxSteps ?? 8
  const waiting = new Map<string, Waiting>()
  const active = new Map<string, { controller: AbortController; owner: unknown }>()

  const result = (use: ToolUse, text: string, isError: boolean): ToolResult => ({
    type: 'tool_result',
    toolUseId: use.id,
    content: wrapToolResult(deps.registry.get(use.name)?.dataSource ?? `tool:${use.name}`, text),
    ...(isError ? { isError: true } : {})
  })

  /** 앞선 대화의 마지막이 결과 없는 tool_use 로 끝나 있으면(앱 재시작 등) 취소 결과로 닫아 대화를 이어 갈 수 있게 한다. */
  function closeDangling(id: string): void {
    const messages = deps.repo.messages(id)
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const uses = last.content.filter((b): b is ToolUse => b.type === 'tool_use')
    if (uses.length === 0) return
    deps.repo.append(id, { role: 'user', content: uses.map((u) => result(u, CANCELED, true)) })
  }

  async function execute(tool: CommandTool, input: unknown): Promise<{ text: string; isError: boolean }> {
    try {
      return { text: await tool.run(input), isError: false }
    } catch {
      // 저장소 예외의 내용은 모델에 넘기지 않는다.
      return { text: '도구를 실행하지 못했습니다.', isError: true }
    }
  }

  const fail = (conversationId: string, items: TranscriptItem[], error: CommandErrorKind): TurnState => ({
    conversationId,
    status: 'error',
    items,
    pending: [],
    error
  })

  /**
   * 중지로 끝난 턴을 대화 기록에 닫는다: 그때까지 받은 글만 "(중지됨)" 과 함께 assistant 글로 남긴다.
   * 끝나지 않은 tool_use 는 기록하지 않았으므로(그래서 도구도 실행하지 않았다) 다음 요청의 기록이 API 규칙에 맞는다.
   */
  function canceledTurn(conversationId: string, items: TranscriptItem[], partial: string, run: Run): TurnState {
    run.canceled = true
    const body = partial.trim() === '' ? STOPPED : `${partial}\n\n${STOPPED}`
    deps.repo.append(conversationId, { role: 'assistant', content: [{ type: 'text', text: body }] })
    items.push({ kind: 'assistant', text: body })
    return { conversationId, status: 'done', items, pending: [] }
  }

  async function loop(conversationId: string, modelId: string, items: TranscriptItem[], run: Run): Promise<TurnState> {
    let adapter: LlmAdapter
    try {
      adapter = deps.getAdapter(modelId)
    } catch (error) {
      return fail(conversationId, items, error instanceof LlmError ? error.kind : 'unknown')
    }

    for (let step = 0; step < maxSteps; step++) {
      // 도구를 돌리는 사이에 중지가 왔으면 모델을 다시 부르지 않는다(기록은 user 결과로 끝나 있다).
      if (run.signal.aborted) return canceledTurn(conversationId, items, '', run)

      let response
      try {
        response = await adapter.chat({
          system: SYSTEM_PROMPT,
          messages: deps.repo.messages(conversationId),
          tools: deps.registry.llmTools(),
          signal: run.signal,
          onText: (text) => run.emit({ kind: 'text', text })
        })
      } catch (error) {
        return fail(conversationId, items, error instanceof LlmError ? error.kind : 'unknown')
      }

      // 멈췄거나, 끝나는 순간에 멈추라는 요청이 왔다: 받은 글만 남기고 도구 호출은 버린다.
      if (response.aborted || run.signal.aborted) return canceledTurn(conversationId, items, textOf(response.content), run)

      if (response.stopReason === 'refusal') {
        // 이미 흘려보낸 글은 안내로 바꾼다. 부분 글을 결과 항목으로 남기지 않는다.
        // (모르는 블록은 그대로 보관해 다음 요청에 돌려보낸다.)
        if (response.content.length > 0) deps.repo.append(conversationId, { role: 'assistant', content: response.content })
        run.emit({ kind: 'replace', reason: 'refusal' })
        return fail(conversationId, items, 'refusal')
      }

      deps.repo.append(conversationId, { role: 'assistant', content: response.content })
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim() !== '') items.push({ kind: 'assistant', text: block.text })
      }

      const uses = response.content.filter((b): b is ToolUse => b.type === 'tool_use')
      if (uses.length > 0 && response.stopReason === 'max_tokens') {
        // 잘린 도구 호출은 실행하지 않는다. 짝은 맞춰 둔다.
        deps.repo.append(conversationId, { role: 'user', content: uses.map((u) => result(u, '응답이 잘려 실행하지 않았습니다.', true)) })
        return fail(conversationId, items, 'too_long')
      }
      if (response.stopReason === 'max_tokens') return fail(conversationId, items, 'too_long')
      if (uses.length === 0) return { conversationId, status: 'done', items, pending: [] }

      const results = new Map<string, ToolResult>()
      const calls: PendingCall[] = []
      for (const use of uses) {
        const tool = deps.registry.get(use.name)
        if (!tool) {
          results.set(use.id, result(use, `알 수 없는 도구: ${use.name}`, true))
          items.push({ kind: 'tool', name: use.name, source: 'core', readOnly: true, status: 'error', summary: '알 수 없는 도구' })
          continue
        }
        const parsed = tool.parse(use.input)
        if (!parsed.ok) {
          results.set(use.id, result(use, `입력이 올바르지 않습니다: ${parsed.message}`, true))
          items.push({ kind: 'tool', name: use.name, source: sourceOf(tool), readOnly: tool.readOnly, status: 'error', summary: '입력이 올바르지 않음' })
          continue
        }
        if (tool.readOnly) {
          run.emit({ kind: 'tool', name: use.name })
          const out = await execute(tool, parsed.value)
          results.set(use.id, result(use, out.text, out.isError))
          items.push({ kind: 'tool', name: use.name, source: sourceOf(tool), readOnly: true, status: out.isError ? 'error' : 'done', summary: summary(out.text) })
          continue
        }
        // write: 미리보기만 만들고 사용자의 승인을 기다린다.
        let preview
        try {
          preview = tool.preview ? tool.preview(parsed.value) : { title: use.name, lines: [] }
        } catch {
          results.set(use.id, result(use, '미리보기를 만들지 못해 실행하지 않았습니다.', true))
          items.push({ kind: 'tool', name: use.name, source: sourceOf(tool), readOnly: false, status: 'error', summary: '미리보기 실패' })
          continue
        }
        calls.push({ use, tool, input: parsed.value, approval: { callId: use.id, toolName: use.name, source: sourceOf(tool), preview } })
      }

      if (calls.length > 0) {
        if (run.signal.aborted) {
          // 승인을 묻기 전에 중지됐다: 거절과 같게 닫는다.
          for (const call of calls) {
            results.set(call.use.id, result(call.use, REJECTED, true))
            items.push({ kind: 'tool', name: call.use.name, source: call.approval.source, readOnly: false, status: 'rejected', summary: call.approval.preview.title })
          }
          deps.repo.append(conversationId, { role: 'user', content: uses.map((u) => results.get(u.id) as ToolResult) })
          return canceledTurn(conversationId, items, '', run)
        }
        waiting.set(conversationId, { modelId, uses, results, calls, emit: run.emit })
        return { conversationId, status: 'awaiting_approval', items, pending: calls.map((c) => c.approval) }
      }
      // tool_result 는 한 user 메시지에 모아서 보낸다.
      deps.repo.append(conversationId, { role: 'user', content: uses.map((u) => results.get(u.id) as ToolResult) })
    }
    return fail(conversationId, items, 'step_limit')
  }

  /** 기다리던 쓰기 동작을 결정대로 처리하고 결과를 한 user 메시지로 기록한다(모델은 부르지 않는다). */
  async function settle(conversationId: string, decisions: readonly Decision[]): Promise<{ w: Waiting; items: TranscriptItem[] } | null> {
    const w = waiting.get(conversationId)
    if (!w) return null
    waiting.delete(conversationId)

    const approved = new Set(decisions.filter((d) => d.approve).map((d) => d.callId))
    const items: TranscriptItem[] = []
    for (const call of w.calls) {
      if (!approved.has(call.use.id)) {
        w.results.set(call.use.id, result(call.use, REJECTED, true))
        items.push({ kind: 'tool', name: call.use.name, source: call.approval.source, readOnly: false, status: 'rejected', summary: call.approval.preview.title })
        continue
      }
      const out = await execute(call.tool, call.input)
      w.results.set(call.use.id, result(call.use, out.text, out.isError))
      items.push({ kind: 'tool', name: call.use.name, source: call.approval.source, readOnly: false, status: out.isError ? 'error' : 'done', summary: summary(out.text) })
    }
    deps.repo.append(conversationId, { role: 'user', content: w.uses.map((u) => w.results.get(u.id) as ToolResult) })
    return { w, items }
  }

  /** 한 번의 요청을 돌린다: 중지용 컨트롤러를 두고, 끝나면 결과에 맞는 마지막 이벤트를 보낸다. */
  async function runTurn(conversationId: string, emit: EmitEvent | undefined, owner: unknown, work: (run: Run) => Promise<TurnState>): Promise<TurnState> {
    const controller = new AbortController()
    const entry = { controller, owner }
    active.set(conversationId, entry)
    const send = (body: EventBody): void => {
      try {
        emit?.({ ...body, conversationId } as CommandEvent)
      } catch {
        // 이벤트는 표시용이다. 받는 쪽이 실패해도 지시는 계속된다.
      }
    }
    const run: Run = { signal: controller.signal, emit: send, canceled: false }
    try {
      const state = await work(run)
      if (state.status === 'awaiting_approval') send({ kind: 'approval' })
      else if (state.status === 'error') send({ kind: 'error', error: state.error ?? 'unknown' })
      else send({ kind: 'done', ...(run.canceled ? { canceled: true } : {}) })
      return state
    } finally {
      if (active.get(conversationId) === entry) active.delete(conversationId)
    }
  }

  async function decide(conversationId: string, decisions: readonly Decision[], emit?: EmitEvent, owner?: unknown): Promise<TurnState> {
    return runTurn(conversationId, emit, owner, async (run) => {
      const settled = await settle(conversationId, decisions)
      if (!settled) return { conversationId, status: 'done', items: [], pending: [] }
      return loop(conversationId, settled.w.modelId, settled.items, run)
    })
  }

  return {
    async send({ conversationId, modelId, text }, emit, owner) {
      let id = conversationId
      if (id === null) id = deps.repo.create({ title: text.trim().replace(/\s+/g, ' '), modelId }).id
      else {
        if (!deps.repo.get(id)) throw new ConversationNotFoundError(id)
        if (waiting.has(id)) await settle(id, []) // 새 말이 오면 기다리던 승인은 거절로 닫는다(모델은 부르지 않는다).
        else closeDangling(id)
        deps.repo.setModel(id, modelId)
      }
      const message: Message = { role: 'user', content: [{ type: 'text', text }] }
      deps.repo.append(id, message)
      const conversation = id
      return runTurn(conversation, emit, owner, (run) => loop(conversation, modelId, [{ kind: 'user', text }], run))
    },

    decide,

    async cancel(conversationId) {
      if (conversationId === null) {
        for (const entry of active.values()) entry.controller.abort()
        return
      }
      const entry = active.get(conversationId)
      if (entry) return entry.controller.abort()
      // 승인 카드를 기다리는 중이었다면 거절과 같게 닫는다.
      const w = waiting.get(conversationId)
      if (w) {
        await settle(conversationId, [])
        w.emit({ kind: 'done', canceled: true })
      }
    },

    cancelOwner(owner) {
      if (owner === undefined || owner === null) return // 주인을 모르는 요청은 이 길로 멈추지 않는다
      for (const entry of active.values()) if (entry.owner === owner) entry.controller.abort()
    },

    pending(conversationId) {
      return waiting.get(conversationId)?.calls.map((c) => c.approval) ?? []
    },

    transcript(conversationId) {
      const items: TranscriptItem[] = []
      for (const m of deps.repo.messages(conversationId)) {
        for (const b of m.content) {
          if (b.type !== 'text') continue
          items.push({ kind: m.role, text: b.text })
        }
      }
      return items
    }
  }
}

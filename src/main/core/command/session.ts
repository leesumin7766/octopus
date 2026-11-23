import type {
  CommandErrorKind,
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
  /** 새 대화(conversationId=null)를 시작하거나 이어서 말한다. */
  send(input: { conversationId: string | null; modelId: string; text: string }): Promise<TurnState>
  /** 승인 대기 중인 쓰기 동작에 대한 결정. 빠진 항목은 거절로 본다. */
  decide(conversationId: string, decisions: readonly Decision[]): Promise<TurnState>
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
}

const REJECTED = '사용자가 이 동작을 거절했습니다. 같은 동작을 다시 시도하지 마세요.'
const CANCELED = '이 동작은 승인 전에 취소되었습니다.'

const sourceOf = (tool: CommandTool): ToolSource => tool.source ?? 'core'
const summary = (text: string): string => (text.length > 200 ? text.slice(0, 200) + '…' : text)

export function createCommandSession(deps: SessionDeps): CommandSession {
  const maxSteps = deps.maxSteps ?? 8
  const waiting = new Map<string, Waiting>()

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

  async function loop(conversationId: string, modelId: string, items: TranscriptItem[]): Promise<TurnState> {
    let adapter: LlmAdapter
    try {
      adapter = deps.getAdapter(modelId)
    } catch (error) {
      return fail(conversationId, items, error instanceof LlmError ? error.kind : 'unknown')
    }

    for (let step = 0; step < maxSteps; step++) {
      let response
      try {
        response = await adapter.chat({ system: SYSTEM_PROMPT, messages: deps.repo.messages(conversationId), tools: deps.registry.llmTools() })
      } catch (error) {
        return fail(conversationId, items, error instanceof LlmError ? error.kind : 'unknown')
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
      if (response.stopReason === 'refusal') return fail(conversationId, items, 'refusal')
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
        waiting.set(conversationId, { modelId, uses, results, calls })
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

  async function decide(conversationId: string, decisions: readonly Decision[]): Promise<TurnState> {
    const settled = await settle(conversationId, decisions)
    if (!settled) return { conversationId, status: 'done', items: [], pending: [] }
    return loop(conversationId, settled.w.modelId, settled.items)
  }

  return {
    async send({ conversationId, modelId, text }) {
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
      return loop(id, modelId, [{ kind: 'user', text }])
    },

    decide,

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

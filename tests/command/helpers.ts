import { createConversationRepository, type ConversationRepository } from '../../src/main/core/command/conversationRepository'
import type { ChatRequest, ChatResponse, LlmAdapter } from '../../src/main/core/command/llm/types'
import { LlmError } from '../../src/main/core/command/llm/types'
import { createCommandSession, type CommandSession } from '../../src/main/core/command/session'
import { createCoreTools } from '../../src/main/core/command/tools/coreTools'
import { createToolRegistry, type CommandTool, type ToolRegistry } from '../../src/main/core/command/tools/registry'
import { createRoutineRepository } from '../../src/main/core/routines/routineRepository'
import { createMemoRepository, type MemoRepository } from '../../src/main/core/memos/memoRepository'
import type { ContentBlock } from '../../src/shared/command/types'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

export const text = (t: string): ContentBlock => ({ type: 'text', text: t })
export const use = (id: string, name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id, name, input })

export const reply = (content: ContentBlock[], stopReason: ChatResponse['stopReason'] = 'end_turn'): ChatResponse => ({
  content,
  stopReason,
  usage: { inputTokens: 1, outputTokens: 1 }
})

/** 미리 정한 응답을 차례로 돌려주는 가짜 모델. 받은 요청을 requests 에 모은다. 진짜 네트워크는 쓰지 않는다. */
export function scripted(steps: (ChatResponse | LlmError)[]): LlmAdapter & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  let i = 0
  return {
    requests,
    async chat(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as ChatRequest)
      const step = steps[Math.min(i++, steps.length - 1)]
      if (step instanceof LlmError) throw step
      return step
    }
  }
}

export interface Env {
  t: TestRepo
  memos: MemoRepository
  conv: ConversationRepository
  registry: ToolRegistry
  session: CommandSession
  adapter: ReturnType<typeof scripted>
  ran: string[]
}

export function createEnv(steps: (ChatResponse | LlmError)[], extraTools: CommandTool[] = [], maxSteps?: number, adapterOverride?: LlmAdapter): Env {
  const t = createTestRepo(new Date(2026, 2, 10, 12, 0, 0).toISOString())
  const memos = createMemoRepository(t.db, { now: () => new Date(2026, 2, 10, 12, 0, 0), tasks: t.repo })
  let n = 0
  const conv = createConversationRepository(t.db, { newId: () => `01ARZ3NDEKTSV4RRFFQ69G5F${String(10 + n++).padStart(2, '0')}`, now: () => `2026-03-10T12:00:${String(n % 60).padStart(2, '0')}.000Z` })
  const routines = createRoutineRepository(t.db, { now: () => new Date(2026, 2, 10, 12, 0, 0), tasks: t.repo })
  const core = createCoreTools({ tasks: t.repo, memos, routines, today: () => '2026-03-10' })
  const registry = createToolRegistry([() => core, () => extraTools])
  const adapter = (adapterOverride ?? scripted(steps)) as ReturnType<typeof scripted>
  const session = createCommandSession({ repo: conv, registry, getAdapter: () => adapter, maxSteps })
  return { t, memos, conv, registry, session, adapter, ran: [] }
}

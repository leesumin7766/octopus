import type { ApprovalPreview, ToolSource as ToolOrigin } from '../../../../shared/command/types'
import type { LlmTool } from '../llm/types'

export type ParseResult<I> = { ok: true; value: I } | { ok: false; message: string }

/** 지시하기가 쓰는 도구. readOnly 가 아니면(write) 실행 전에 미리보기 → 사용자 승인을 거친다. */
export interface CommandTool<I = unknown> {
  name: string
  description: string
  /** JSON Schema(object, additionalProperties:false, 모든 속성 required — strict 호환) */
  inputSchema: Record<string, unknown>
  readOnly: boolean
  /** 모델에 "엄격한 스키마"(strict)로 알릴지. 코어 도구는 true(기본), 남이 만든 스키마(MCP 등)는 false. */
  strict?: boolean
  /** 결과를 감쌀 <data source=…> 이름. 생략하면 tool:<이름>. 바깥 서버의 결과는 출처를 구분해 쓴다. */
  dataSource?: string
  /** 어디서 온 도구인지(core, mcp, 'arm:<id>'). 생략하면 core. */
  source?: ToolOrigin
  /** 모델이 준 입력을 검사한다. 검사를 통과한 값만 preview·run 에 간다. */
  parse(raw: unknown): ParseResult<I>
  /** write 도구: 무엇을·어디에·어떻게 바뀌는지 */
  preview?(input: I): ApprovalPreview
  /** 결과를 사람이 읽는 글자로 돌려준다. 실패하면 예외. */
  run(input: I): string | Promise<string>
}

export type ToolSource = () => readonly CommandTool[]

/** 도구 레지스트리 = 코어 도구 + (나중에) 연결된 Arm 의 tools() + MCP 도구. 출처는 함수로 꽂는다. */
export interface ToolRegistry {
  list(): CommandTool[]
  get(name: string): CommandTool | undefined
  llmTools(): LlmTool[]
}

export function createToolRegistry(sources: readonly ToolSource[]): ToolRegistry {
  // 호출 때마다 다시 모아 연결·해제가 곧바로 반영된다. 이름이 겹치면 먼저 등록한 쪽(코어)이 이긴다.
  const collect = (): CommandTool[] => {
    const seen = new Map<string, CommandTool>()
    for (const source of sources) {
      let tools: readonly CommandTool[] = []
      try {
        tools = source()
      } catch {
        continue // 출처 하나가 죽어도 나머지는 산다.
      }
      for (const tool of tools) if (!seen.has(tool.name)) seen.set(tool.name, tool)
    }
    return [...seen.values()]
  }

  return {
    list: collect,
    get: (name) => collect().find((t) => t.name === name),
    llmTools: () => collect().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, ...(t.strict === false ? { strict: false } : {}) }))
  }
}

// ---- 입력 검사 도우미 ----

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringField(raw: unknown, field: string, max: number): ParseResult<string> {
  if (!isRecord(raw)) return { ok: false, message: 'input must be an object' }
  const v = raw[field]
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) return { ok: false, message: `${field} must be a non-empty string up to ${max} characters` }
  return { ok: true, value: v }
}

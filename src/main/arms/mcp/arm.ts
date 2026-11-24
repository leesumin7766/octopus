import { createHash } from 'node:crypto'
import type { McpServerConfig, McpToolInfo } from '../../../shared/mcp/types'
import { isAllowedMcpUrl } from '../../../shared/validation/mcp'
import type { CommandTool } from '../../core/command/tools/registry'
import { ArmError, type Arm, type ArmContext, type ArmSecrets } from '../sdk/types'
import { McpAuthRequiredError, McpCallError, McpSpawnError, type McpConnection, type McpConnector, type RawTool } from './connection'
import { prefixedToolNames } from './naming'

// MCP 서버 하나 = 동적 Arm 하나(auth 'mcp', capabilities ['command.tools']).
// 도구는 지시하기 레지스트리에 들어가며, 서버가 readOnlyHint=true 로 알린 것만 읽기 전용이고 나머지는 전부 쓰기(승인 필요)다.

export const DEFAULT_CALL_TIMEOUT_MS = 60_000
export const DEFAULT_CONNECT_TIMEOUT_MS = 60_000
export const MAX_RESULT_BYTES = 50 * 1024
export const ENV_SECRET = 'env'

export const MESSAGES = {
  notAllowed: '실행을 허용하지 않았어요. [다시 연결]을 눌러 허용하면 연결할 수 있어요.',
  needsApproval: '처음 실행하려면 허용이 필요해요. [다시 연결]을 눌러 확인해 주세요.',
  spawnFailed: '명령을 실행하지 못했거나 바로 종료됐어요. 명령 이름과 설치 여부를 확인해 주세요.',
  oauth: '이 서버는 로그인이 필요해서 아직 쓸 수 없어요.',
  failed: 'MCP 서버에 연결하지 못했어요. 주소(또는 명령)를 확인하고 [다시 연결]을 눌러 주세요.',
  closed: '서버와의 연결이 끊어졌어요. [다시 연결]을 눌러 주세요.',
  badUrl: '서버 주소가 올바르지 않아요. https:// 로 시작하거나, 이 PC 안에서 도는 서버의 http:// 주소여야 해요.',
  unsupportedContent: '[지원하지 않는 내용]',
  truncated: `\n…[잘림: ${MAX_RESULT_BYTES / 1024}KB 를 넘는 부분은 버렸어요]`,
  disconnected: '[서버와 연결이 끊어졌어요]',
  callFailed: '[도구 호출에 실패했어요]',
  serverError: '[서버가 오류를 알렸어요]'
} as const

/** 실행을 허용한 (명령 + 인자) 의 지문. 명령이나 인자가 하나라도 바뀌면 달라진다. */
export function commandFingerprint(command: string, args: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([command, args])).digest('hex')
}

export interface McpApprovals {
  isApproved(id: string, hash: string): boolean
  approve(id: string, hash: string): void
}

export interface McpArmDeps {
  config: McpServerConfig
  /** 이 Arm 의 비밀 이름공간(서버별 환경 변수 값이 들어 있다) */
  secrets: ArmSecrets
  connector: McpConnector
  approvals: McpApprovals
  /** stdio 처음 실행 확인 창. 허용하면 true. 사용자가 누른 것만 허용으로 본다. */
  confirmRun: (info: { name: string; command: string; args: string[] }) => Promise<boolean>
  callTimeoutMs?: number
  connectTimeoutMs?: number
  maxResultBytes?: number
}

export interface McpArm extends Arm {
  toolInfos(): McpToolInfo[]
}

export function readEnv(secrets: ArmSecrets): Record<string, string> {
  try {
    const raw = secrets.get(ENV_SECRET)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function truncateBytes(text: string, max: number): string {
  if (Buffer.byteLength(text, 'utf8') <= max) return text
  return Buffer.from(text, 'utf8').subarray(0, max).toString('utf8').replace(/�+$/, '') + MESSAGES.truncated
}

/** 도구 결과 content 를 글자로: text 만 쓰고 나머지(이미지 등)는 "[지원하지 않는 내용]" */
export function renderContent(content: unknown[]): string {
  const parts = content.map((item) => (isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? item.text : MESSAGES.unsupportedContent))
  return parts.join('\n')
}

const short = (value: unknown): string => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/** 승인 카드에 보일 입력 요약: 키마다 한 줄, 최대 8개 */
function summarize(input: Record<string, unknown>): string[] {
  const entries = Object.entries(input)
  const lines = entries.slice(0, 8).map(([k, v]) => `${k}: ${short(v)}`)
  if (entries.length > 8) lines.push(`… 외 ${entries.length - 8}개`)
  return lines.length > 0 ? lines : ['(입력 없음)']
}

export function createMcpArm(deps: McpArmDeps): McpArm {
  const { config } = deps
  const callTimeout = deps.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const maxBytes = deps.maxResultBytes ?? MAX_RESULT_BYTES
  let connection: McpConnection | null = null
  let closing = false
  let deadReason: string | null = null
  let generation = 0

  const commandLine = (): string => [config.command ?? '', ...(config.args ?? [])].join(' ')

  function buildTools(): { tool: CommandTool; info: McpToolInfo }[] {
    if (!connection || deadReason) return []
    const raw: RawTool[] = connection.tools()
    const names = prefixedToolNames(config.name, config.id, raw.map((t) => t.name))
    return raw.map((t, i) => {
      const readOnly = t.annotations?.readOnlyHint === true // 힌트가 없거나 false 면 쓰기로 본다(보수적).
      const description = `${(t.description ?? '').slice(0, 1000)} (MCP 서버: ${config.name})`.trim()
      const tool: CommandTool<Record<string, unknown>> = {
        name: names[i],
        description,
        inputSchema: { ...t.inputSchema, type: 'object' },
        strict: false, // 남이 만든 스키마는 strict 규칙을 따르지 않는다.
        dataSource: `mcp:${config.name}`,
        source: `mcp:${config.id}`,
        readOnly,
        parse: (input) => (isRecord(input) && JSON.stringify(input).length <= 100_000 ? { ok: true, value: input } : { ok: false, message: 'input must be a JSON object' }),
        ...(readOnly ? {} : { preview: (input) => ({ title: `${config.name} 의 ${t.name} 실행`, lines: summarize(input) }) }),
        async run(input) {
          const conn = connection
          if (!conn || deadReason) return MESSAGES.disconnected
          try {
            const result = await conn.callTool(t.name, input, callTimeout)
            const text = renderContent(Array.isArray(result.content) ? result.content : [])
            return truncateBytes(result.isError ? `${MESSAGES.serverError}\n${text}` : text, maxBytes)
          } catch (error) {
            if (error instanceof McpCallError && error.kind === 'timeout') return `[시간 초과: ${Math.round(callTimeout / 1000)}초 안에 응답하지 않았어요]`
            if (error instanceof McpCallError && error.kind === 'closed') return MESSAGES.disconnected
            return MESSAGES.callFailed
          }
        }
      }
      return { tool: tool as CommandTool, info: { name: names[i], description: (t.description ?? '').slice(0, 300), readOnly } }
    })
  }

  async function closeConnection(): Promise<void> {
    const conn = connection
    connection = null
    closing = true
    try {
      await conn?.close()
    } catch {
      // 이미 닫혔다.
    }
  }

  return {
    manifest: {
      id: config.id,
      name: config.name,
      version: '1.0.0',
      auth: 'mcp',
      capabilities: ['command.tools'],
      description: config.transport === 'http' ? `MCP 서버 · ${config.url}` : `MCP 서버 · ${commandLine()}`.slice(0, 300)
    },

    async connect(ctx: ArmContext) {
      await closeConnection() // 다시 연결: 이전 연결과 프로세스를 먼저 정리한다.
      closing = false
      deadReason = null
      const mine = ++generation

      let transport
      if (config.transport === 'http') {
        if (!isAllowedMcpUrl(config.url)) throw new ArmError(MESSAGES.badUrl)
        transport = { kind: 'http' as const, url: config.url }
      } else {
        const command = config.command ?? ''
        const args = config.args ?? []
        const hash = commandFingerprint(command, args)
        if (!deps.approvals.isApproved(config.id, hash)) {
          // 처음(또는 명령이 바뀐 뒤 처음)에는 사용자가 확인해야 한다. 앱을 켤 때의 자동 재연결에서는 창을 띄우지 않는다.
          if (!ctx.interactive) throw new ArmError(MESSAGES.needsApproval)
          if (!(await deps.confirmRun({ name: config.name, command, args }))) throw new ArmError(MESSAGES.notAllowed)
          deps.approvals.approve(config.id, hash)
        }
        transport = { kind: 'stdio' as const, command, args, env: readEnv(ctx.secrets) } // 환경 변수 값은 여기서만 읽는다(로그에서는 가려진다).
      }

      let conn: McpConnection
      try {
        conn = await deps.connector({
          transport,
          connectTimeoutMs: deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          onStderr: (line) => ctx.log.debug(`server: ${line}`),
          onClosed: () => {
            // 우리가 닫은 것이 아니면 서버가 죽거나 끊긴 것이다 → 오류 상태(앱과 지시하기는 계속 동작).
            if (!closing && mine === generation) deadReason = MESSAGES.closed
          }
        })
      } catch (error) {
        if (error instanceof McpAuthRequiredError) throw new ArmError(MESSAGES.oauth)
        if (error instanceof McpSpawnError) throw new ArmError(MESSAGES.spawnFailed)
        ctx.log.warn('mcp connect failed', error)
        throw new ArmError(MESSAGES.failed)
      }
      connection = conn
      ctx.log.info(`mcp connected (${conn.tools().length} tools)`)
    },

    async disconnect() {
      await closeConnection()
    },

    dispose() {
      void closeConnection()
    },

    status: () => (deadReason ? { state: 'error', reason: deadReason } : { state: 'on' }),

    tools: () => buildTools().map((t) => t.tool),
    toolInfos: () => buildTools().map((t) => t.info)
  }
}

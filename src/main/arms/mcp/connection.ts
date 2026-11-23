import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

// 공식 MCP SDK 를 감싸는 얇은 층. 프로토콜은 직접 구현하지 않는다.
// 전송: Streamable HTTP(주소) 또는 stdio(명령 + 인자 배열, 셸을 거치지 않는다).

export interface RawTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}

export interface RawResult {
  isError?: boolean
  content: unknown[]
}

export type McpCallFailure = 'timeout' | 'closed' | 'failed'

/** 호출 실패. 메시지에 서버가 보낸 내용을 넣지 않는다. */
export class McpCallError extends Error {
  readonly kind: McpCallFailure
  constructor(kind: McpCallFailure) {
    super(`mcp call ${kind}`)
    this.name = 'McpCallError'
    this.kind = kind
  }
}

/** 원격 서버가 로그인(OAuth)을 요구한다. 지금은 지원하지 않는다. */
export class McpAuthRequiredError extends Error {
  constructor() {
    super('mcp server requires oauth')
    this.name = 'McpAuthRequiredError'
  }
}

/** 프로그램을 시작하지 못했다(명령이 없음 등). */
export class McpSpawnError extends Error {
  constructor() {
    super('mcp server could not start')
    this.name = 'McpSpawnError'
  }
}

export interface McpConnection {
  /** 지금 알려진 도구 목록(서버가 목록이 바뀌었다고 알리면 자동으로 갱신된다) */
  tools(): RawTool[]
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<RawResult>
  close(): Promise<void>
  /** 자식 프로세스 id(stdio 일 때, 시험용) */
  pid(): number | null
}

export type McpTransportOptions =
  | { kind: 'http'; url: string }
  | { kind: 'stdio'; command: string; args: string[]; /** 사용자가 정한 환경 변수(기본 환경 위에 얹는다) */ env: Record<string, string> }

export interface ConnectOptions {
  transport: McpTransportOptions
  connectTimeoutMs: number
  /** 서버가 끊기거나 프로세스가 죽었을 때(우리가 닫은 경우에도 불린다) */
  onClosed: () => void
  /** 서버의 stderr 한 줄(stdio) */
  onStderr?: (line: string) => void
}

export type McpConnector = (options: ConnectOptions) => Promise<McpConnection>

async function listAll(client: Client): Promise<RawTool[]> {
  const tools: RawTool[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await client.listTools(cursor ? { cursor } : undefined)
    for (const t of result.tools) tools.push(t as unknown as RawTool)
    if (!result.nextCursor) break
    cursor = result.nextCursor
  }
  return tools
}

/** 진짜 SDK 로 연결한다. */
export const sdkConnector: McpConnector = async (options) => {
  let current: RawTool[] = []
  const client = new Client(
    { name: 'octopus', version: '0.1.0' },
    {
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (!error && tools) current = tools as unknown as RawTool[]
          }
        }
      }
    }
  )
  client.onclose = () => options.onClosed()
  client.onerror = () => undefined // 세부 내용은 남기지 않는다.

  let stdio: StdioClientTransport | null = null
  const transport =
    options.transport.kind === 'http'
      ? new StreamableHTTPClientTransport(new URL(options.transport.url))
      : (stdio = new StdioClientTransport({
          command: options.transport.command,
          args: options.transport.args,
          // 자식 프로세스 환경: 필수 몇 개(PATH 등, SDK 기본) + 사용자가 이 서버에 정한 값만.
          env: { ...getDefaultEnvironment(), ...options.transport.env },
          stderr: 'pipe'
        }))

  if (stdio?.stderr && options.onStderr) {
    let buffer = ''
    const stderr = stdio.stderr as NodeJS.ReadableStream
    stderr.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '') options.onStderr?.(line.slice(0, 500))
    })
  } else (stdio?.stderr as NodeJS.ReadableStream | null | undefined)?.resume()

  try {
    await client.connect(transport, { timeout: options.connectTimeoutMs })
    current = await listAll(client)
  } catch (error) {
    await client.close().catch(() => undefined)
    if (error instanceof UnauthorizedError) throw new McpAuthRequiredError()
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') throw new McpSpawnError()
    // 없는 명령은 Windows(cross-spawn)에서 곧바로 종료(연결 닫힘)로 나타나기도 한다.
    if (options.transport.kind === 'stdio' && error instanceof McpError && error.code === ErrorCode.ConnectionClosed) throw new McpSpawnError()
    throw error
  }

  return {
    tools: () => current,
    pid: () => stdio?.pid ?? null,
    async callTool(name, args, timeoutMs) {
      try {
        return (await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs })) as unknown as RawResult
      } catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) throw new McpCallError('timeout')
        if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) throw new McpCallError('closed')
        throw new McpCallError('failed')
      }
    },
    close: () => client.close()
  }
}

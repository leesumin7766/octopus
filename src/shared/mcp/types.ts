import type { IpcResult } from '../ipc'
import type { ArmStatus } from '../arms/types'

// MCP 서버(= 동적 Arm 하나)의 main·renderer 공용 타입.

export type McpTransport = 'http' | 'stdio'

/** 설정(mcp.servers)에 저장되는 서버 한 개. 환경 변수 값은 여기에 없고 이름만 있다. */
export interface McpServerConfig {
  /** 'mcp-' + 짧은 ULID(소문자). Arm id 와 같다. */
  id: string
  name: string
  transport: McpTransport
  /** http: 주소 */
  url?: string
  /** stdio: 실행 명령과 인자(셸 문자열이 아니라 배열) */
  command?: string
  args?: string[]
  /** 서버별 환경 변수 이름. 값은 그 Arm 의 비밀 이름공간에만 있다. */
  envKeys: string[]
}

export interface McpToolInfo {
  name: string
  description: string
  /** 서버가 readOnlyHint=true 로 알린 도구만 true. 그 외는 모두 쓰기(승인 필요). */
  readOnly: boolean
}

/** 화면에 보이는 서버 한 개 */
export interface McpServerInfo {
  id: string
  name: string
  transport: McpTransport
  /** http: 주소, stdio: 실행 명령 한 줄(보기용) */
  target: string
  envKeys: string[]
  status: ArmStatus
  tools: McpToolInfo[]
}

export interface McpAddInput {
  name: string
  transport: McpTransport
  url?: string
  command?: string
  args?: string[]
  env?: { name: string; value: string }[]
}

export interface McpApi {
  list(): Promise<IpcResult<McpServerInfo[]>>
  /** 서버를 저장하고 연결한다. stdio 는 처음 실행 전에 main 이 확인 창을 띄운다(거부하면 status error). 값은 돌려주지 않는다. */
  add(input: McpAddInput): Promise<IpcResult<McpServerInfo>>
  /** 연결을 끊고 목록·설정·저장된 환경 변수(비밀)를 지운다. */
  remove(id: string): Promise<IpcResult<null>>
  /** 다시 연결한다(stdio 는 이미 허용한 명령이면 확인 없이). */
  reconnect(id: string): Promise<IpcResult<McpServerInfo>>
}

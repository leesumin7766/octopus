import type { McpAddInput, McpServerConfig } from '../mcp/types'
import { bad, good, isPlainObject, type Parsed } from './taskIpc'

// MCP 서버 입력 검사. 주소 규칙·명령 규칙·환경 변수 이름 규칙.

export const MCP_ID = /^mcp-[a-z0-9]{4,16}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const MAX_NAME = 40
const MAX_URL = 2000
const MAX_COMMAND = 1000
const MAX_ARGS = 100
const MAX_ARG = 2000
const MAX_ENV = 30
const MAX_ENV_VALUE = 4000

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** https 는 어디든, http 는 이 PC(localhost·127.0.0.1)만. 주소에 로그인 정보(user:pass@)를 넣을 수 없다. */
export function isAllowedMcpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '') return false
  if (url.protocol === 'https:') return url.hostname !== ''
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}

const noNul = (s: string): boolean => !s.includes('\0')

export function isValidCommand(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_COMMAND && noNul(value)
}

export function isValidArgs(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ARGS && value.every((a) => typeof a === 'string' && a.length <= MAX_ARG && noNul(a))
}

export function isValidEnvName(value: unknown): value is string {
  return typeof value === 'string' && ENV_NAME.test(value)
}

function isValidName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.trim().length <= MAX_NAME
}

/** 화면에서 추가하는 서버 입력 검사 */
export function parseMcpAddInput(value: unknown): Parsed<McpAddInput> {
  if (!isPlainObject(value)) return bad('input')
  if (!Object.keys(value).every((k) => ['name', 'transport', 'url', 'command', 'args', 'env'].includes(k))) return bad('input')
  if (!isValidName(value.name)) return bad('name')
  const name = (value.name as string).trim()

  if (value.transport === 'http') {
    if (!isAllowedMcpUrl(value.url)) return bad('url')
    if (value.command !== undefined || value.args !== undefined || value.env !== undefined) return bad('input')
    return good({ name, transport: 'http', url: value.url })
  }
  if (value.transport === 'stdio') {
    if (!isValidCommand(value.command)) return bad('command')
    const args = value.args === undefined ? [] : value.args
    if (!isValidArgs(args)) return bad('args')
    const env = value.env === undefined ? [] : value.env
    if (!Array.isArray(env) || env.length > MAX_ENV) return bad('env')
    const seen = new Set<string>()
    const pairs: { name: string; value: string }[] = []
    for (const e of env) {
      if (!isPlainObject(e) || !isValidEnvName(e.name) || typeof e.value !== 'string' || e.value.length > MAX_ENV_VALUE || !noNul(e.value) || seen.has(e.name)) return bad('env')
      seen.add(e.name)
      pairs.push({ name: e.name, value: e.value })
    }
    if (value.url !== undefined) return bad('input')
    return good({ name, transport: 'stdio', command: (value.command as string).trim(), args, env: pairs })
  }
  return bad('transport')
}

function parseConfig(raw: unknown): McpServerConfig | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.id !== 'string' || !MCP_ID.test(raw.id) || !isValidName(raw.name)) return null
  if (!Array.isArray(raw.envKeys) || raw.envKeys.length > MAX_ENV || !raw.envKeys.every(isValidEnvName)) return null
  const base = { id: raw.id, name: (raw.name as string).trim(), envKeys: [...new Set(raw.envKeys as string[])] }
  if (raw.transport === 'http') return isAllowedMcpUrl(raw.url) ? { ...base, transport: 'http', url: raw.url, envKeys: [] } : null
  if (raw.transport === 'stdio') {
    if (!isValidCommand(raw.command)) return null
    const args = raw.args === undefined ? [] : raw.args
    return isValidArgs(args) ? { ...base, transport: 'stdio', command: raw.command, args } : null
  }
  return null
}

/** 새로 저장하는 서버 목록 검사: 하나라도 틀렸거나 id 가 겹치면 null */
export function parseMcpServers(raw: unknown): McpServerConfig[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null
  const out: McpServerConfig[] = []
  for (const item of raw) {
    const config = parseConfig(item)
    if (!config || out.some((c) => c.id === config.id)) return null
    out.push(config)
  }
  return out
}

/** 저장되어 있던 목록을 읽는다. 틀린 항목은 버리고 나머지는 살린다(앱이 켜질 때 서버 하나 때문에 전부 잃지 않게). */
export function normalizeMcpServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return []
  const out: McpServerConfig[] = []
  for (const item of raw) {
    const config = parseConfig(item)
    if (config && !out.some((c) => c.id === config.id)) out.push(config)
  }
  return out
}

/** stdio 실행 허용 기록: 서버 id 와 (명령+인자)의 지문 */
export interface McpApproval {
  id: string
  hash: string
}

export function parseMcpApprovals(raw: unknown): McpApproval[] | null {
  if (!Array.isArray(raw) || raw.length > 100) return null
  const out: McpApproval[] = []
  for (const a of raw) {
    if (!isPlainObject(a) || typeof a.id !== 'string' || !MCP_ID.test(a.id) || typeof a.hash !== 'string' || !/^[a-f0-9]{64}$/.test(a.hash)) return null
    out.push({ id: a.id, hash: a.hash })
  }
  return out
}

export function parseMcpId(value: unknown): Parsed<string> {
  return typeof value === 'string' && MCP_ID.test(value) ? good(value) : bad('id')
}

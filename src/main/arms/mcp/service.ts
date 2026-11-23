import type { McpAddInput, McpServerConfig, McpServerInfo } from '../../../shared/mcp/types'
import type { McpApproval } from '../../../shared/validation/mcp'
import type { SecureStore } from '../../platform/secureStore'
import { createArmSecrets } from '../sdk/context'
import type { ArmManager } from '../sdk/manager'
import { createMcpArm, ENV_SECRET, type McpApprovals, type McpArm, type McpArmDeps } from './arm'
import type { McpConnector } from './connection'

/** 설정 저장소 중 서비스가 쓰는 부분 */
export interface McpSettings {
  getServers(): McpServerConfig[]
  setServers(servers: McpServerConfig[]): void
  getApprovals(): McpApproval[]
  setApprovals(approvals: McpApproval[]): void
}

export interface McpServiceDeps {
  manager: ArmManager
  settings: McpSettings
  secureStore: SecureStore
  connector: McpConnector
  confirmRun: McpArmDeps['confirmRun']
  /** ULID 한 개(시각 순). 뒤쪽 무작위 8자로 id 를 만든다. */
  newUlid: () => string
  callTimeoutMs?: number
  connectTimeoutMs?: number
  maxResultBytes?: number
}

export interface McpService {
  /** 저장된 서버를 모두 Arm 으로 등록한다(연결은 하지 않는다 — 이전에 연결돼 있던 것은 ArmManager.start() 가 조용히 다시 연결한다). */
  init(): void
  list(): McpServerInfo[]
  /** 저장하고 연결한다. 환경 변수 값은 그 Arm 의 비밀 이름공간에만 쓰고 설정에는 이름만 남긴다. */
  add(input: McpAddInput): Promise<McpServerInfo>
  remove(id: string): Promise<boolean>
  reconnect(id: string): Promise<McpServerInfo | undefined>
}

/** 보기용 한 줄 명령 */
export function commandLine(command: string, args: readonly string[]): string {
  const quote = (s: string): string => (/[\s"']/.test(s) || s === '' ? JSON.stringify(s) : s)
  return [command, ...args].map(quote).join(' ')
}

export function createMcpService(deps: McpServiceDeps): McpService {
  const arms = new Map<string, McpArm>()

  const approvals: McpApprovals = {
    isApproved: (id, hash) => deps.settings.getApprovals().some((a) => a.id === id && a.hash === hash),
    approve(id, hash) {
      const rest = deps.settings.getApprovals().filter((a) => a.id !== id) // 한 서버에는 마지막으로 허용한 명령 하나만 남긴다.
      deps.settings.setApprovals([...rest, { id, hash }])
    }
  }

  function makeArm(config: McpServerConfig): McpArm {
    return createMcpArm({
      config,
      secrets: createArmSecrets(deps.secureStore, config.id),
      connector: deps.connector,
      approvals,
      confirmRun: deps.confirmRun,
      callTimeoutMs: deps.callTimeoutMs,
      connectTimeoutMs: deps.connectTimeoutMs,
      maxResultBytes: deps.maxResultBytes
    })
  }

  function infoOf(config: McpServerConfig): McpServerInfo {
    const armInfo = deps.manager.get(config.id)
    const status = armInfo?.status ?? { state: 'off' as const }
    return {
      id: config.id,
      name: config.name,
      transport: config.transport,
      target: config.transport === 'http' ? (config.url ?? '') : commandLine(config.command ?? '', config.args ?? []),
      envKeys: [...config.envKeys],
      status,
      tools: status.state === 'on' ? (arms.get(config.id)?.toolInfos() ?? []) : []
    }
  }

  const find = (id: string): McpServerConfig | undefined => deps.settings.getServers().find((s) => s.id === id)

  return {
    init() {
      for (const config of deps.settings.getServers()) {
        if (arms.has(config.id)) continue
        const arm = makeArm(config)
        if (deps.manager.register(arm).ok) arms.set(config.id, arm)
      }
    },

    list: () => deps.settings.getServers().map(infoOf),

    async add(input) {
      const existing = new Set(deps.settings.getServers().map((s) => s.id))
      let id = ''
      do id = `mcp-${deps.newUlid().slice(-8).toLowerCase()}`
      while (existing.has(id))

      const config: McpServerConfig =
        input.transport === 'http'
          ? { id, name: input.name, transport: 'http', url: input.url, envKeys: [] }
          : { id, name: input.name, transport: 'stdio', command: input.command, args: input.args ?? [], envKeys: (input.env ?? []).map((e) => e.name) }

      if (input.transport === 'stdio' && input.env && input.env.length > 0) {
        const env = Object.fromEntries(input.env.map((e) => [e.name, e.value]))
        createArmSecrets(deps.secureStore, id).set(ENV_SECRET, JSON.stringify(env)) // 값은 비밀 이름공간에만
      }
      deps.settings.setServers([...deps.settings.getServers(), config])
      const arm = makeArm(config)
      const registered = deps.manager.register(arm)
      if (!registered.ok) {
        // 등록할 수 없는 서버는 저장하지 않는다.
        deps.settings.setServers(deps.settings.getServers().filter((s) => s.id !== id))
        deps.secureStore.deleteNamespace(`arm:${id}`)
        throw new Error('mcp arm could not be registered')
      }
      arms.set(id, arm)
      await deps.manager.connect(id) // stdio 는 여기서 확인 창이 뜬다. 거부·실패해도 서버는 남고 status 가 error 가 된다.
      return infoOf(config)
    },

    async remove(id) {
      const config = find(id)
      if (!config) return false
      await deps.manager.unregister(id) // 끊고(프로세스 종료) 비밀 이름공간을 지우고 도구를 해제한다.
      arms.delete(id)
      deps.settings.setServers(deps.settings.getServers().filter((s) => s.id !== id))
      deps.settings.setApprovals(deps.settings.getApprovals().filter((a) => a.id !== id))
      return true
    },

    async reconnect(id) {
      const config = find(id)
      if (!config) return undefined
      await deps.manager.connect(id)
      return infoOf(config)
    }
  }
}

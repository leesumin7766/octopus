import type { ArmInfo, ArmStatus } from '../../../shared/arms/types'
import type { CommandTool } from '../../core/command/tools/registry'
import type { SecureStore } from '../../platform/secureStore'
import { armNamespace, createArmContext, type LogEntry } from './context'
import type { HttpDeps } from './http'
import { validateManifest } from './manifest'
import { ArmError, type Arm, type ArmCoreServices } from './types'

// Arm 수명주기 관리자. Arm 의 예외·거부된 Promise·시간 초과는 모두 여기서 잡아 status 'error' 로만 바꾼다.
// 어떤 경우에도 코어(할 일·메모·지시하기)로 전파하지 않는다. 계약: docs/contracts/arm.md

export const DEFAULT_SYNC_MINUTES = 15
export const DEFAULT_CONNECT_TIMEOUT_MS = 120_000
export const DEFAULT_SYNC_TIMEOUT_MS = 60_000
const DISCONNECT_TIMEOUT_MS = 10_000

/** 사용자에게 보이는 이유 문구(main 에서 직접 만드는 것들) */
export const REASONS = {
  connectFailed: '연결하지 못했어요. 잠시 뒤 [다시 연결]을 눌러 주세요.',
  connectTimeout: '연결이 너무 오래 걸려서 멈췄어요. [다시 연결]을 눌러 주세요.',
  reconnectNeeded: '다시 로그인이 필요해요. [다시 연결]을 눌러 주세요.',
  syncFailed: '가져오기에 실패했어요. 잠시 뒤 자동으로 다시 시도해요. 계속되면 [다시 연결]을 눌러 주세요.',
  syncTimeout: '가져오는 데 너무 오래 걸려서 멈췄어요. 잠시 뒤 자동으로 다시 시도해요.',
  armStatus: '이 도구가 문제를 알려 왔어요. [다시 연결]을 눌러 주세요.'
} as const

/** 설정 저장소 중 관리자가 쓰는 부분 */
export interface ArmSettings {
  getConnected(): string[]
  setConnected(ids: string[]): void
  getAutoAccept(): string[]
  setAutoAccept(ids: string[]): void
}

export interface Scheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface ArmManagerDeps {
  secureStore: SecureStore
  settings: ArmSettings
  /** Arm 한 개에 줄 코어 공개 서비스(출처 Arm 이 고정된 것) */
  coreFor: (armId: string) => ArmCoreServices
  http: HttpDeps
  logSink: (entry: LogEntry) => void
  scheduler?: Scheduler
  connectTimeoutMs?: number
  syncTimeoutMs?: number
  now?: () => Date
}

export interface ArmManager {
  /** Arm 등록. 매니페스트가 틀렸거나 id 가 겹치면 등록하지 않고 이유를 돌려준다(예외 없음). */
  register(arm: Arm): { ok: true } | { ok: false; problems: string[] }
  list(): ArmInfo[]
  get(id: string): ArmInfo | undefined
  /** 연결을 끝까지 기다린다. 실패해도 던지지 않고 상태가 'error' 가 된다. 모르는 id 면 undefined. */
  connect(id: string, options?: { interactive?: boolean }): Promise<ArmInfo | undefined>
  /** 끊기: Arm 정리 → 비밀 이름공간 전체 삭제 → 도구 해제. 할 일은 그대로 둔다. */
  disconnect(id: string): Promise<ArmInfo | undefined>
  /** 지금 한 번 가져오기 */
  syncNow(id: string): Promise<ArmInfo | undefined>
  setAutoAccept(id: string, on: boolean): ArmInfo | undefined
  /** 고급 옵션: 내 OAuth 클라이언트 저장/지우기. 지원하지 않는 Arm 이면 undefined. */
  setClient(id: string, value: { clientId: string; clientSecret?: string } | null): ArmInfo | undefined
  /** Arm 을 등록에서 뺀다: 먼저 끊고(비밀 삭제 포함) 목록에서 지운다. 없는 id 면 false. */
  unregister(id: string): Promise<boolean>
  /** 앱을 켤 때: 이전에 연결돼 있던 Arm 을 조용히(interactive=false) 다시 연결한다. */
  start(): Promise<void>
  /** 연결된 Arm 들이 내놓는 지시하기 도구. 도구 레지스트리의 출처로 꽂는다. */
  tools(): CommandTool[]
  onChange(listener: () => void): () => void
  dispose(): void
}

interface Entry {
  arm: Arm
  state: ArmStatus
  timer: unknown
  syncing: boolean
  /** 이번 실행에서 연결에 한 번이라도 성공했는지(sync 실패로 오류가 된 것과 연결 실패를 구분) */
  connectedOnce: boolean
  /** 같은 Arm 의 connect 가 겹치지 않게 하는 진행 중 Promise */
  connecting: Promise<void> | null
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('timeout')), ms)
  })
  // 시간이 지난 뒤 늦게 거부되는 Promise 가 처리되지 않은 거부로 새지 않게 한다.
  promise.catch(() => undefined)
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const defaultScheduler: Scheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
}

export function createArmManager(deps: ArmManagerDeps): ArmManager {
  const scheduler = deps.scheduler ?? defaultScheduler
  const connectTimeout = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const syncTimeout = deps.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 알림을 받는 쪽의 문제가 관리자를 멈추게 하지 않는다.
      }
    }
  }

  const log = (armId: string, level: LogEntry['level'], message: string): void => {
    try {
      deps.logSink({ level, armId, message })
    } catch {
      // 로그 실패는 무시
    }
  }

  function setState(entry: Entry, state: ArmStatus): void {
    entry.state = state
    notify()
  }

  /** 사용자에게 보일 이유. ArmError 만 문구를 그대로 쓰고, 나머지는 일반 문구(원문 예외는 로그에도 이름만). */
  function reasonOf(entry: Entry, error: unknown, fallback: string, timeoutText: string): string {
    if (error instanceof TimeoutError) return timeoutText
    if (error instanceof ArmError && error.message.trim() !== '') return error.message
    log(entry.arm.manifest.id, 'warn', `arm failed: ${error instanceof Error ? error.name : typeof error}`)
    return fallback
  }

  /** manifest 의 sync 주기 */
  const intervalMs = (entry: Entry): number => (entry.arm.manifest.syncIntervalMinutes ?? DEFAULT_SYNC_MINUTES) * 60_000

  function stopSchedule(entry: Entry): void {
    if (entry.timer !== null) scheduler.clearInterval(entry.timer)
    entry.timer = null
  }

  function startSchedule(entry: Entry): void {
    stopSchedule(entry)
    if (!entry.arm.sync) return
    entry.timer = scheduler.setInterval(() => void runSync(entry), intervalMs(entry))
  }

  async function runSync(entry: Entry): Promise<void> {
    if (!entry.arm.sync || entry.syncing) return
    if (entry.state.state !== 'on' && entry.state.state !== 'error') return
    // 연결을 아직 못 한(오류 상태로 시작한) Arm 은 sync 로 되살아나지 않는다 — 다시 연결해야 한다.
    if (entry.state.state === 'error' && !entry.connectedOnce) return
    entry.syncing = true
    try {
      await withTimeout(Promise.resolve().then(() => entry.arm.sync?.()), syncTimeout)
      if (entry.state.state === 'error') setState(entry, { state: 'on' })
    } catch (error) {
      setState(entry, { state: 'error', reason: reasonOf(entry, error, REASONS.syncFailed, REASONS.syncTimeout) })
    } finally {
      entry.syncing = false
    }
  }

  const contextFor = (entry: Entry, interactive: boolean) =>
    createArmContext({
      armId: entry.arm.manifest.id,
      interactive,
      secureStore: deps.secureStore,
      http: deps.http,
      logSink: deps.logSink,
      core: deps.coreFor(entry.arm.manifest.id)
    })

  const infoOf = (entry: Entry): ArmInfo => {
    const m = entry.arm.manifest
    let status = entry.state
    if (status.state === 'on') {
      // Arm 이 스스로 문제를 알려 오면(토큰 만료 등) 그대로 보여 준다.
      try {
        const own = entry.arm.status()
        if (own.state === 'error') status = { state: 'error', reason: own.reason?.trim() ? own.reason : REASONS.armStatus }
      } catch {
        // status() 가 던져도 관리자 상태를 쓴다.
      }
    }
    let unavailableReason: string | undefined
    try {
      const a = entry.arm.availability?.()
      if (a && !a.available) unavailableReason = a.reason
    } catch {
      // availability() 가 던져도 연결할 수 있는 것으로 본다.
    }
    let clientIdSaved: boolean | undefined
    try {
      clientIdSaved = entry.arm.advanced?.clientIdSaved()
    } catch {
      clientIdSaved = undefined
    }
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description ?? '',
      auth: m.auth,
      capabilities: [...m.capabilities],
      status: { ...status },
      ...(unavailableReason ? { unavailableReason } : {}),
      ...(clientIdSaved === undefined ? {} : { advanced: { clientIdSaved } }),
      autoAccept: deps.settings.getAutoAccept().includes(m.id)
    }
  }

  function saveConnected(id: string, on: boolean): void {
    try {
      const ids = new Set(deps.settings.getConnected())
      if (on) ids.add(id)
      else ids.delete(id)
      deps.settings.setConnected([...ids])
    } catch {
      log(id, 'warn', 'could not save the connected list')
    }
  }

  async function connect(id: string, options: { interactive?: boolean; keepListOnFailure?: boolean } = {}): Promise<ArmInfo | undefined> {
    const entry = entries.get(id)
    if (!entry) return undefined
    if (infoOf(entry).unavailableReason) return infoOf(entry) // 이 빌드에서는 연결할 수 없다: Arm 을 부르지 않는다.
    if (entry.connecting) {
      await entry.connecting
      return infoOf(entry)
    }

    const work = (async () => {
      setState(entry, { state: 'connecting' })
      try {
        await withTimeout(Promise.resolve().then(() => entry.arm.connect(contextFor(entry, options.interactive ?? true))), connectTimeout)
      } catch (error) {
        setState(entry, { state: 'error', reason: reasonOf(entry, error, options.interactive === false ? REASONS.reconnectNeeded : REASONS.connectFailed, REASONS.connectTimeout) })
        return
      }
      entry.connectedOnce = true
      setState(entry, { state: 'on' })
      saveConnected(id, true)
      startSchedule(entry)
      await runSync(entry) // 연결 직후 한 번 가져온다.
    })()
    entry.connecting = work.finally(() => {
      entry.connecting = null
    })
    await entry.connecting
    return infoOf(entry)
  }

  return {
    register(arm) {
      const result = validateManifest(arm?.manifest)
      if (!result.ok) return { ok: false, problems: result.problems }
      if (entries.has(result.manifest.id)) return { ok: false, problems: ['an arm with this id is already registered'] }
      entries.set(result.manifest.id, { arm, state: { state: 'off' }, timer: null, syncing: false, connecting: null, connectedOnce: false })
      notify()
      return { ok: true }
    },

    list: () => [...entries.values()].map(infoOf),
    get: (id) => (entries.has(id) ? infoOf(entries.get(id) as Entry) : undefined),
    connect: (id, options) => connect(id, options),

    async disconnect(id) {
      const entry = entries.get(id)
      if (!entry) return undefined
      stopSchedule(entry)
      try {
        await withTimeout(Promise.resolve().then(() => entry.arm.disconnect()), DISCONNECT_TIMEOUT_MS)
      } catch (error) {
        reasonOf(entry, error, '', '') // 이유는 버리고 로그만 남긴다. 끊기는 항상 끝까지 한다.
      }
      try {
        deps.secureStore.deleteNamespace(armNamespace(id)) // 이 Arm 의 비밀 전부
      } catch {
        log(id, 'warn', 'could not delete the secret namespace')
      }
      entry.connectedOnce = false
      saveConnected(id, false)
      setState(entry, { state: 'off' })
      return infoOf(entry)
    },

    async syncNow(id) {
      const entry = entries.get(id)
      if (!entry) return undefined
      await runSync(entry)
      return infoOf(entry)
    },

    setAutoAccept(id, on) {
      const entry = entries.get(id)
      if (!entry) return undefined
      const ids = new Set(deps.settings.getAutoAccept())
      if (on) ids.add(id)
      else ids.delete(id)
      deps.settings.setAutoAccept([...ids])
      notify()
      return infoOf(entry)
    },

    setClient(id, value) {
      const entry = entries.get(id)
      if (!entry?.arm.advanced) return undefined
      try {
        entry.arm.advanced.setClient(value)
      } catch {
        log(id, 'warn', 'could not save the client setting')
      }
      notify()
      return infoOf(entry)
    },

    async unregister(id) {
      const entry = entries.get(id)
      if (!entry) return false
      await this.disconnect(id)
      entries.delete(id)
      notify()
      return true
    },

    async start() {
      const wanted = new Set(deps.settings.getConnected())
      // 한 Arm 이 오래 걸려도 다른 Arm 의 재연결을 막지 않는다.
      await Promise.all([...entries.keys()].filter((id) => wanted.has(id)).map((id) => connect(id, { interactive: false })))
    },

    tools() {
      const out: CommandTool[] = []
      for (const entry of entries.values()) {
        if (!entry.arm.tools || infoOf(entry).status.state !== 'on') continue // 연결이 끊겼다고 알려 온 Arm 의 도구는 내놓지 않는다
        let tools: CommandTool[] = []
        try {
          tools = entry.arm.tools()
        } catch {
          log(entry.arm.manifest.id, 'warn', 'tools() failed')
          continue
        }
        for (const tool of tools) out.push({ ...tool, source: tool.source ?? `arm:${entry.arm.manifest.id}` }) // Arm 이 출처를 직접 밝히면(MCP: mcp:<id>) 그대로 둔다
      }
      return out
    },

    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    dispose() {
      for (const entry of entries.values()) {
        stopSchedule(entry)
        try {
          entry.arm.dispose?.() // 자식 프로세스·연결 정리(비밀은 지우지 않는다)
        } catch {
          // 종료 중의 오류는 무시
        }
      }
      listeners.clear()
    }
  }
}

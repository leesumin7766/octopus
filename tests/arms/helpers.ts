import { vi } from 'vitest'
import { createArmManager, type ArmManager, type ArmManagerDeps, type Scheduler } from '../../src/main/arms/sdk/manager'
import type { Arm, ArmContext } from '../../src/main/arms/sdk/types'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import type { ArmManifest } from '../../src/shared/arms/types'

export const manifest = (over: Partial<ArmManifest> = {}): ArmManifest => ({
  id: 'test-arm',
  name: '테스트 Arm',
  version: '1.0.0',
  auth: 'none',
  capabilities: ['tasks.import'],
  description: '시험용 Arm',
  ...over
})

export interface FakeArmOptions {
  manifest?: Partial<ArmManifest>
  connect?: (ctx: ArmContext) => Promise<void>
  disconnect?: () => Promise<void>
  sync?: () => Promise<{ added?: number }>
  status?: Arm['status']
  tools?: Arm['tools']
}

/** 시험용 Arm. 받은 ArmContext 를 contexts 에 모은다. */
export function fakeArm(options: FakeArmOptions = {}): Arm & { contexts: ArmContext[] } {
  const contexts: ArmContext[] = []
  const arm: Arm & { contexts: ArmContext[] } = {
    contexts,
    manifest: manifest(options.manifest),
    async connect(ctx) {
      contexts.push(ctx)
      await options.connect?.(ctx)
    },
    async disconnect() {
      await options.disconnect?.()
    },
    status: options.status ?? (() => ({ state: 'on' })),
    ...(options.sync ? { sync: options.sync } : {}),
    ...(options.tools ? { tools: options.tools } : {})
  }
  return arm
}

/** 직접 한 번씩 돌릴 수 있는 가짜 스케줄러 */
export function fakeScheduler(): Scheduler & { tick(): void; active(): number; intervals: number[] } {
  const jobs = new Map<number, () => void>()
  const intervals: number[] = []
  let next = 1
  return {
    intervals,
    setInterval(fn, ms) {
      intervals.push(ms)
      jobs.set(next, fn)
      return next++
    },
    clearInterval(handle) {
      jobs.delete(handle as number)
    },
    tick: () => jobs.forEach((fn) => fn()),
    active: () => jobs.size
  }
}

export interface ManagerEnv {
  manager: ManagerHandle
  store: ReturnType<typeof createMemorySecureStore>
  settings: { connected: string[]; autoAccept: string[] }
  scheduler: ReturnType<typeof fakeScheduler>
  logs: { level: string; armId: string; message: string; data?: unknown }[]
  added: { armId: string; ref: string }[]
}
type ManagerHandle = ArmManager

export function createManagerEnv(over: Partial<ArmManagerDeps> = {}): ManagerEnv {
  const store = createMemorySecureStore()
  const settings = { connected: [] as string[], autoAccept: [] as string[] }
  const scheduler = fakeScheduler()
  const logs: ManagerEnv['logs'] = []
  const added: ManagerEnv['added'] = []
  const manager = createArmManager({
    secureStore: over.secureStore ?? store,
    settings: {
      getConnected: () => settings.connected,
      setConnected: (ids) => void (settings.connected = ids),
      getAutoAccept: () => settings.autoAccept,
      setAutoAccept: (ids) => void (settings.autoAccept = ids)
    },
    coreFor: (armId) => ({
      addInboxCandidate: (c) => {
        added.push({ armId, ref: c.ref })
        return { added: true, accepted: false }
      },
      listTasks: () => [],
      onTasksChanged: () => () => {}
    }),
    http: { fetch: vi.fn(async () => { throw new Error('tests must not use the network') }), sleep: async () => {} },
    logSink: (entry) => void logs.push(entry),
    scheduler,
    ...over
  })
  return { manager, store: (over.secureStore ?? store) as typeof store, settings, scheduler, logs, added }
}

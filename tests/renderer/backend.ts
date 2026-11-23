import { vi, type Mock } from 'vitest'
import { createAdapterResolver, type KeyStore } from '../../src/main/core/command/adapterResolver'
import { createConversationRepository } from '../../src/main/core/command/conversationRepository'
import type { LlmAdapter } from '../../src/main/core/command/llm/types'
import { createCommandSession } from '../../src/main/core/command/session'
import { createCoreTools } from '../../src/main/core/command/tools/coreTools'
import { createToolRegistry } from '../../src/main/core/command/tools/registry'
import { createCommandHandlers } from '../../src/main/ipc/command'
import type { CommandApi } from '../../src/shared/command/ipcApi'
import type { LlmProvider } from '../../src/shared/command/types'
import { createUlidGenerator } from '../../src/shared/tasks/ulid'
import { scripted } from '../command/helpers'
import { createArmManager, type ArmManager } from '../../src/main/arms/sdk/manager'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import { createCandidateRepository, type CandidateRepository } from '../../src/main/core/inbox/candidateRepository'
import { createArmsHandlers, createCandidateHandlers } from '../../src/main/ipc/arms'
import type { ArmsApi, CandidatesApi } from '../../src/shared/arms/ipcApi'
import { createMemoRepository, type MemoRepository } from '../../src/main/core/memos/memoRepository'
import { createRoutineRepository, type RoutineRepository } from '../../src/main/core/routines/routineRepository'
import { createSettingsRepository, type SettingsRepository } from '../../src/main/core/settings/settingsRepository'
import { createShortcutRepository, type ShortcutRepository } from '../../src/main/core/shortcuts/shortcutRepository'
import { createMemoHandlers } from '../../src/main/ipc/memos'
import { createRoutineHandlers } from '../../src/main/ipc/routines'
import { createSettingsHandlers } from '../../src/main/ipc/settings'
import { createShortcutHandlers } from '../../src/main/ipc/shortcuts'
import type { ShortcutPlatform } from '../../src/main/platform/shortcutPlatform'
import { createTaskHandlers } from '../../src/main/ipc/tasks'
import type { OctopusApi } from '../../src/shared/api'
import type { MemosApi } from '../../src/shared/memos/ipcApi'
import type { RoutinesApi } from '../../src/shared/routines/ipcApi'
import type { SettingsApi } from '../../src/shared/settings/ipcApi'
import type { ShortcutsApi } from '../../src/shared/shortcuts/ipcApi'
import type { TasksApi } from '../../src/shared/tasks/ipcApi'
import { localDateString } from '../../src/shared/tasks/dates'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

// React 에게 테스트(act) 환경임을 알린다.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export type TaskSpies = { [K in keyof TasksApi]: Mock<TasksApi[K]> }
export type RoutineSpies = { [K in keyof RoutinesApi]: Mock<RoutinesApi[K]> }
export type MemoSpies = { [K in keyof MemosApi]: Mock<MemosApi[K]> }
export type SettingsSpies = { [K in keyof SettingsApi]: Mock<SettingsApi[K]> }
export type ShortcutSpies = { [K in keyof ShortcutsApi]: Mock<ShortcutsApi[K]> }
export type ArmsSpies = { [K in keyof ArmsApi]: Mock<ArmsApi[K]> }
export type CandidateSpies = { [K in keyof CandidatesApi]: Mock<CandidatesApi[K]> }
export type CommandSpies = { [K in keyof CommandApi]: Mock<CommandApi[K]> }

/** 운영체제와 닿는 동작의 가짜. 테스트가 실제로 무언가를 열 일은 없다. */
export type FakePlatform = { [K in keyof ShortcutPlatform]: Mock<ShortcutPlatform[K]> }

export interface Backend {
  t: TestRepo
  routineRepo: RoutineRepository
  memoRepo: MemoRepository
  settingsRepo: SettingsRepository
  shortcutRepo: ShortcutRepository
  platform: FakePlatform
  /** window.octopus.tasks 로 들어가는 함수들. 호출 인자를 확인하거나 결과를 바꿀 수 있다. */
  tasks: TaskSpies
  routines: RoutineSpies
  memos: MemoSpies
  settings: SettingsSpies
  shortcuts: ShortcutSpies
  command: CommandSpies
  arms: ArmsSpies
  candidates: CandidateSpies
  /** 시험용 Arm 을 등록·연결하는 진짜 관리자(비밀 저장소는 메모리) */
  armManager: ArmManager
  candidateRepo: CandidateRepository
  /** 원본 열기로 main 이 연 주소들 */
  opened: string[]
  /** 보안 저장소 대신 메모리에 있는 키. 테스트가 직접 넣고 확인한다(화면에는 나오지 않아야 한다). */
  keys: Partial<Record<LlmProvider, string>>
  /** 가짜 모델의 다음 응답들을 정한다. 진짜 API 는 부르지 않는다. */
  setLlm(steps: Parameters<typeof scripted>[0]): ReturnType<typeof scripted>
}

/**
 * window.octopus 를 가짜로 넣는다. 가짜의 뒤에는 진짜 IPC 핸들러와 메모리 DB 저장소가 있어서
 * 화면이 보낸 요청이 실제 검증·저장을 거친다. "지금"은 vi 의 가짜 Date 를 따른다.
 */
export function installBackend(initialView: OctopusApi['initialView'] = null): Backend {
  const t = createTestRepo(new Date().toISOString())
  const now = (): Date => new Date()
  const routineRepo = createRoutineRepository(t.db, { now, tasks: t.repo })
  const memoRepo = createMemoRepository(t.db, { now, tasks: t.repo })
  const settingsRepo = createSettingsRepository(t.db)
  const shortcutRepo = createShortcutRepository(t.db, { now })
  const platform: FakePlatform = {
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    pathExists: vi.fn(() => true),
    pickPath: vi.fn(async () => null),
    confirmRunExecutable: vi.fn(async () => true)
  }
  const logError = (): void => {}

  const taskHandlers = createTaskHandlers({
    getRepository: () => t.repo,
    now,
    logError,
    ensureRoutineTasks: (today) => void routineRepo.ensureTodayTasks(today)
  })
  const routineHandlers = createRoutineHandlers({ getRepository: () => routineRepo, now, logError })
  const memoHandlers = createMemoHandlers({ getRepository: () => memoRepo, now, logError })
  const settingsHandlers = createSettingsHandlers({ getRepository: () => settingsRepo, logError })
  const shortcutHandlers = createShortcutHandlers({ getRepository: () => shortcutRepo, platform, logError })

  const keys: Partial<Record<LlmProvider, string>> = {}
  const keyStore: KeyStore = { get: (p) => keys[p], set: (p, k) => void (keys[p] = k), delete: (p) => void delete keys[p] }
  let llm: ReturnType<typeof scripted> = scripted([])
  const resolve = createAdapterResolver({
    keys: keyStore,
    models: () => settingsRepo.get('command.models'),
    // 어댑터는 만들어지지 않으므로(아래 getAdapter) 이 클라이언트는 쓰이지 않는다. 혹시 불리면 실패해서 알려 준다.
    createAnthropicClient: () => {
      const refuse = async (): Promise<never> => {
        throw new Error('tests must not call the API')
      }
      return { messages: { create: refuse }, beta: { messages: { create: refuse } } }
    },
    fetch: () => {
      throw new Error('tests must not call the network')
    }
  })
  const newId = createUlidGenerator()
  const conversations = createConversationRepository(t.db, { newId: () => newId(Date.now()), now: () => now().toISOString() })
  const registry = createToolRegistry([() => createCoreTools({ tasks: t.repo, memos: memoRepo, routines: routineRepo, today: () => localDateString(now()) })])
  const session = createCommandSession({
    repo: conversations,
    registry,
    getAdapter: (modelId): LlmAdapter => {
      resolve(modelId) // 키가 없으면 no_key 로 던진다(진짜 어댑터는 만들지 않는다).
      return llm
    }
  })
  const commandHandlers = createCommandHandlers({
    getSession: () => session,
    getRepository: () => conversations,
    getModels: () => settingsRepo.get('command.models'),
    keys: keyStore,
    logError
  })
  const command = {
    models: vi.fn(async () => commandHandlers.models()),
    setKey: vi.fn(async (provider: unknown, key: unknown) => commandHandlers.setKey(provider, key)),
    clearKey: vi.fn(async (provider: unknown) => commandHandlers.clearKey(provider)),
    send: vi.fn(async (input: unknown) => commandHandlers.send(input)),
    decide: vi.fn(async (id: unknown, decisions: unknown) => commandHandlers.decide(id, decisions)),
    pending: vi.fn(async (id: unknown) => commandHandlers.pending(id)),
    conversations: vi.fn(async () => commandHandlers.conversations()),
    transcript: vi.fn(async (id: unknown) => commandHandlers.transcript(id)),
    removeConversation: vi.fn(async (id: unknown) => commandHandlers.removeConversation(id))
  } as unknown as CommandSpies

  const candidateRepo = createCandidateRepository(t.db, { newId: () => newId(Date.now()), now, tasks: t.repo })
  const armSettings = { connected: [] as string[], autoAccept: [] as string[] }
  const armManager = createArmManager({
    secureStore: createMemorySecureStore(),
    settings: {
      getConnected: () => armSettings.connected,
      setConnected: (ids) => void (armSettings.connected = ids),
      getAutoAccept: () => armSettings.autoAccept,
      setAutoAccept: (ids) => void (armSettings.autoAccept = ids)
    },
    coreFor: (armId) => ({
      addInboxCandidate: (c) => candidateRepo.add(armId, c, { autoAccept: armSettings.autoAccept.includes(armId) }),
      listTasks: () => []
    }),
    http: { fetch: async () => { throw new Error('tests must not use the network') }, sleep: async () => {} },
    logSink: () => {},
    scheduler: { setInterval: () => 0, clearInterval: () => {} }
  })
  const opened: string[] = []
  const armsDeps = { getManager: () => armManager, getCandidates: () => candidateRepo, openExternal: async (url: string) => void opened.push(url), logError }
  const armHandlers = createArmsHandlers(armsDeps)
  const candidateHandlers = createCandidateHandlers(armsDeps)
  const arms = {
    list: vi.fn(async () => armHandlers.list()),
    connect: vi.fn(async (id: unknown) => armHandlers.connect(id)),
    disconnect: vi.fn(async (id: unknown) => armHandlers.disconnect(id)),
    setAutoAccept: vi.fn(async (id: unknown, on: unknown) => armHandlers.setAutoAccept(id, on))
  } as unknown as ArmsSpies
  const candidates = {
    list: vi.fn(async () => candidateHandlers.list()),
    accept: vi.fn(async (id: unknown) => candidateHandlers.accept(id)),
    dismiss: vi.fn(async (id: unknown) => candidateHandlers.dismiss(id)),
    acceptAll: vi.fn(async () => candidateHandlers.acceptAll()),
    dismissAll: vi.fn(async () => candidateHandlers.dismissAll()),
    openSource: vi.fn(async (id: unknown) => candidateHandlers.openSource(id))
  } as unknown as CandidateSpies

  const tasks = {
    list: vi.fn(async (view: unknown) => taskHandlers.list(view)),
    quickAdd: vi.fn(async (text: unknown) => taskHandlers.quickAdd(text)),
    create: vi.fn(async (input: unknown) => taskHandlers.create(input)),
    update: vi.fn(async (id: unknown, patch: unknown) => taskHandlers.update(id, patch)),
    setStatus: vi.fn(async (id: unknown, status: unknown) => taskHandlers.setStatus(id, status)),
    remove: vi.fn(async (id: unknown) => taskHandlers.remove(id)),
    reorder: vi.fn(async (ids: unknown) => taskHandlers.reorder(ids)),
    moveToToday: vi.fn(async (ids: unknown) => taskHandlers.moveToToday(ids)),
    moveToSomeday: vi.fn(async (ids: unknown) => taskHandlers.moveToSomeday(ids)),
    reschedule: vi.fn(async (ids: unknown, date: unknown) => taskHandlers.reschedule(ids, date)),
    parsePreview: vi.fn(async (text: unknown) => taskHandlers.parsePreview(text))
  } as unknown as TaskSpies

  const routines = {
    list: vi.fn(async () => routineHandlers.list()),
    create: vi.fn(async (input: unknown) => routineHandlers.create(input)),
    update: vi.fn(async (id: unknown, patch: unknown) => routineHandlers.update(id, patch)),
    remove: vi.fn(async (id: unknown) => routineHandlers.remove(id)),
    history: vi.fn(async (days: unknown) => routineHandlers.history(days))
  } as unknown as RoutineSpies

  const memos = {
    list: vi.fn(async () => memoHandlers.list()),
    create: vi.fn(async (body: unknown) => memoHandlers.create(body)),
    update: vi.fn(async (id: unknown, body: unknown) => memoHandlers.update(id, body)),
    remove: vi.fn(async (id: unknown) => memoHandlers.remove(id)),
    togglePin: vi.fn(async (id: unknown) => memoHandlers.togglePin(id)),
    search: vi.fn(async (query: unknown) => memoHandlers.search(query)),
    toTask: vi.fn(async (id: unknown) => memoHandlers.toTask(id))
  } as unknown as MemoSpies

  const settings = {
    get: vi.fn(async (key: unknown) => settingsHandlers.get(key)),
    set: vi.fn(async (key: unknown, value: unknown) => settingsHandlers.set(key, value))
  } as unknown as SettingsSpies

  const shortcuts = {
    list: vi.fn(async () => shortcutHandlers.list()),
    addUrl: vi.fn(async (input: unknown) => shortcutHandlers.addUrl(input)),
    pickPath: vi.fn(async (kind: unknown) => shortcutHandlers.pickPath(kind)),
    open: vi.fn(async (id: unknown) => shortcutHandlers.open(id)),
    rename: vi.fn(async (id: unknown, label: unknown) => shortcutHandlers.rename(id, label)),
    remove: vi.fn(async (id: unknown) => shortcutHandlers.remove(id)),
    move: vi.fn(async (id: unknown, direction: unknown) => shortcutHandlers.move(id, direction))
  } as unknown as ShortcutSpies

  const api: OctopusApi = {
    getAppVersion: async () => '0.0.0-test',
    initialView,
    tasks: tasks as unknown as TasksApi,
    routines: routines as unknown as RoutinesApi,
    memos: memos as unknown as MemosApi,
    settings: settings as unknown as SettingsApi,
    shortcuts: shortcuts as unknown as ShortcutsApi,
    command: command as unknown as CommandApi,
    arms: arms as unknown as ArmsApi,
    candidates: candidates as unknown as CandidatesApi
  }
  Object.defineProperty(window, 'octopus', { value: api, configurable: true, writable: true })

  return { t, routineRepo, memoRepo, settingsRepo, shortcutRepo, platform, tasks, routines, memos, settings, shortcuts, command, arms, candidates, armManager, candidateRepo, opened, keys, setLlm: (steps) => (llm = scripted(steps)) }
}

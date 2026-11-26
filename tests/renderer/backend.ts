import { vi, type Mock } from 'vitest'
import { createAdapterResolver, type KeyStore } from '../../src/main/core/command/adapterResolver'
import type { AnthropicClientLike } from '../../src/main/core/command/llm/anthropicAdapter'
import { createConversationRepository } from '../../src/main/core/command/conversationRepository'
import type { LlmAdapter } from '../../src/main/core/command/llm/types'
import { createCommandSession } from '../../src/main/core/command/session'
import { createCoreTools } from '../../src/main/core/command/tools/coreTools'
import { createToolRegistry } from '../../src/main/core/command/tools/registry'
import { createCommandHandlers } from '../../src/main/ipc/command'
import type { CommandApi } from '../../src/shared/command/ipcApi'
import type { CommandEvent, LlmProvider } from '../../src/shared/command/types'
import { createUlidGenerator } from '../../src/shared/tasks/ulid'
import { scripted } from '../command/helpers'
import { createArmManager, type ArmManager } from '../../src/main/arms/sdk/manager'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import { createCandidateRepository, type CandidateRepository } from '../../src/main/core/inbox/candidateRepository'
import { createArmsHandlers, createCandidateHandlers } from '../../src/main/ipc/arms'
import type { ArmsApi, CandidatesApi } from '../../src/shared/arms/ipcApi'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createObsidianArm, type ObsidianArm } from '../../src/main/arms/obsidian/arm'
import { createObsidianHandlers } from '../../src/main/ipc/obsidian'
import type { ObsidianApi } from '../../src/shared/obsidian/types'
import type { UpdateApi, UpdateState } from '../../src/shared/update/types'
import { createMcpService, type McpService } from '../../src/main/arms/mcp/service'
import type { McpArmDeps } from '../../src/main/arms/mcp/arm'
import type { McpConnection, McpConnector } from '../../src/main/arms/mcp/connection'
import { createMcpHandlers } from '../../src/main/ipc/mcp'
import type { McpApi, McpServerConfig } from '../../src/shared/mcp/types'
import type { McpApproval } from '../../src/shared/validation/mcp'
import { createCalendarHandlers } from '../../src/main/ipc/calendar'
import type { CalendarApi, CalendarToday } from '../../src/shared/calendar/types'
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
export type ObsidianSpies = { [K in keyof ObsidianApi]: Mock<ObsidianApi[K]> }
export type McpSpies = { [K in keyof McpApi]: Mock<McpApi[K]> }
export type CalendarSpies = { [K in keyof CalendarApi]: Mock<CalendarApi[K]> }
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
  obsidian: ObsidianSpies
  obsidianArm: ObsidianArm
  /** 시험용 vault(임시 폴더, .obsidian 이 들어 있다) */
  vault: string
  /** .gitignore 수정 확인 창의 가짜(기본: 허용) */
  obsidianConfirm: Mock<(info: { path: string; line: string }) => Promise<boolean>>
  update: { state: Mock<UpdateApi['state']>; check: Mock<UpdateApi['check']>; download: Mock<UpdateApi['download']>; install: Mock<UpdateApi['install']>; onState: Mock<UpdateApi['onState']> }
  /** 업데이트 상태(기본: 최신). state()·check()·download() 가 이 값을 돌려준다. */
  updateState: UpdateState
  /** main 이 업데이트 상태를 밀어 준 것처럼 화면에 보낸다(updateState 도 바꾼다) */
  emitUpdate: (state: UpdateState) => void
  mcp: McpSpies
  mcpService: McpService
  /** stdio 처음 실행 확인 창의 가짜(기본: 허용) */
  mcpConfirm: Mock<McpArmDeps['confirmRun']>
  /** 진짜 SDK 대신 쓰는 가짜 MCP 연결. 테스트가 바꿀 수 있다. */
  mcpConnector: { current: McpConnector }
  calendar: CalendarSpies
  /** 오늘 일정 카드가 읽는 값. 테스트가 바꾼다(기본: 캘린더 연결 안 됨). */
  calendarState: CalendarToday
  armManager: ArmManager
  candidateRepo: CandidateRepository
  /** 원본 열기로 main 이 연 주소들 */
  opened: string[]
  /** 보안 저장소 대신 메모리에 있는 키. 테스트가 직접 넣고 확인한다(화면에는 나오지 않아야 한다). */
  keys: Partial<Record<LlmProvider, string>>
  /** 가짜 모델의 다음 응답들을 정한다. 진짜 API 는 부르지 않는다. */
  setLlm(steps: Parameters<typeof scripted>[0]): ReturnType<typeof scripted>
  /** 스트리밍 등 직접 만든 가짜 모델을 쓴다. */
  setAdapter(adapter: LlmAdapter): void
  /** 진행 이벤트를 화면으로 직접 보낸다. */
  emitCommandEvent(event: CommandEvent): void
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
  settingsRepo.set('onboarding.done', true) // 첫 실행 안내는 따로 시험한다(다른 화면 시험에 끼어들지 않게)
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
  let llm: LlmAdapter = scripted([])
  // 지시하기 진행 이벤트를 받는 쪽(화면). 진짜 앱에서는 main 이 보낸 창으로 밀어 주는 것을 흉내 낸다.
  const commandListeners = new Set<(event: CommandEvent) => void>()
  const emitCommandEvent = (event: CommandEvent): void => commandListeners.forEach((listener) => listener(event))
  const resolve = createAdapterResolver({
    keys: keyStore,
    models: () => settingsRepo.get('command.models'),
    // 어댑터는 만들어지지 않으므로(아래 getAdapter) 이 클라이언트는 쓰이지 않는다. 혹시 불리면 실패해서 알려 준다.
    createAnthropicClient: () => {
      const refuse = async (): Promise<never> => {
        throw new Error('tests must not call the API')
      }
      const refuseStream = (): never => {
        throw new Error('tests must not call the API')
      }
      // 가짜 클라이언트를 어댑터 형으로 넘기는 곳(시험 쪽에서만 형을 변환한다).
      return { messages: { create: refuse, stream: refuseStream }, beta: { messages: { create: refuse, stream: refuseStream } } } as unknown as AnthropicClientLike
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
    send: vi.fn(async (input: unknown) => commandHandlers.send(input, emitCommandEvent)),
    decide: vi.fn(async (id: unknown, decisions: unknown) => commandHandlers.decide(id, decisions, emitCommandEvent)),
    cancel: vi.fn(async (id: unknown) => commandHandlers.cancel(id)),
    onEvent: vi.fn((listener: (event: CommandEvent) => void) => {
      commandListeners.add(listener)
      return () => void commandListeners.delete(listener)
    }),
    pending: vi.fn(async (id: unknown) => commandHandlers.pending(id)),
    conversations: vi.fn(async () => commandHandlers.conversations()),
    transcript: vi.fn(async (id: unknown) => commandHandlers.transcript(id)),
    removeConversation: vi.fn(async (id: unknown) => commandHandlers.removeConversation(id))
  } as unknown as CommandSpies

  const candidateRepo = createCandidateRepository(t.db, { newId: () => newId(Date.now()), now, tasks: t.repo })
  const armSettings = { connected: [] as string[], autoAccept: [] as string[] }
  const armStore = createMemorySecureStore()
  const armManager = createArmManager({
    secureStore: armStore,
    settings: {
      getConnected: () => armSettings.connected,
      setConnected: (ids) => void (armSettings.connected = ids),
      getAutoAccept: () => armSettings.autoAccept,
      setAutoAccept: (ids) => void (armSettings.autoAccept = ids)
    },
    coreFor: (armId) => ({
      addInboxCandidate: (c) => candidateRepo.add(armId, c, { autoAccept: armSettings.autoAccept.includes(armId) }),
      listTasks: (view) => {
        const day = localDateString(now())
        if (view !== 'today') return t.repo.listView(view, day)
        const today = t.repo.listView('today', day)
        return [...today.overdue, ...today.today]
      },
      listDoneToday: () => {
        const n = now()
        return t.repo.listDoneBetween(new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString(), new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).toISOString())
      },
      onTasksChanged: () => () => {}
    }),
    http: { fetch: async () => { throw new Error('tests must not use the network') }, sleep: async () => {} },
    logSink: () => {},
    scheduler: { setInterval: () => 0, clearInterval: () => {} }
  })
  const opened: string[] = []
  const fakeConnection = (): McpConnection => ({
    tools: () => [
      { name: 'search_notes', description: '노트를 찾아요.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
      { name: 'create_page', description: '페이지를 만들어요.', inputSchema: { type: 'object', properties: {} } }
    ],
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    close: async () => {},
    pid: () => null
  })
  // 옵시디언: 임시 vault 폴더에 진짜로 쓴다(사용자 폴더는 건드리지 않는다).
  const vault = mkdtempSync(join(tmpdir(), 'octopus-test-vault-'))
  mkdirSync(join(vault, '.obsidian'))
  const obsidianConfirm = vi.fn<(info: { path: string; line: string }) => Promise<boolean>>(async () => true)
  const obsidianArm = createObsidianArm({
    config: { get: () => settingsRepo.get('obsidian.config'), set: (next) => void settingsRepo.set('obsidian.config', next) },
    pickFolder: async () => vault,
    confirmGitignore: obsidianConfirm,
    openExternal: async (url) => void opened.push(url),
    backupDir: `${vault}-backup`, // vault 옆(바깥)의 별도 폴더
    setAutoAcceptDefault: () => void armManager.setAutoAccept('obsidian', true),
    now: () => now(),
    debounceMs: 20,
    watchDebounceMs: 20,
    watch: () => () => {},
    runGit: async () => null // 시험에서는 진짜 git 을 실행하지 않는다(.gitignore 해석으로 점검)
  })
  // 옵시디언 Arm 은 필요한 시험에서만 armManager.register(obsidianArm) 로 등록한다(Arms 화면 기본 시험이 영향받지 않게).
  const obsidianHandlers = createObsidianHandlers({ getArm: () => obsidianArm, logError })
  const obsidian = {
    state: vi.fn(async () => obsidianHandlers.state()),
    setConfig: vi.fn(async (patch: unknown) => obsidianHandlers.setConfig(patch)),
    changeVault: vi.fn(async () => obsidianHandlers.changeVault()),
    exportNow: vi.fn(async () => obsidianHandlers.exportNow()),
    fixGitignore: vi.fn(async () => obsidianHandlers.fixGitignore()),
    open: vi.fn(async () => obsidianHandlers.open())
  } as unknown as ObsidianSpies
  const updateState: UpdateState = { status: 'latest', current: '0.1.0' }
  const updateListeners = new Set<(state: UpdateState) => void>()
  const update = {
    state: vi.fn(async () => ({ ok: true as const, data: { ...updateState } })),
    check: vi.fn(async () => ({ ok: true as const, data: { ...updateState } })),
    download: vi.fn(async () => ({ ok: true as const, data: { ...updateState } })),
    install: vi.fn(async () => ({ ok: true as const, data: null })),
    onState: vi.fn((listener: (state: UpdateState) => void) => {
      updateListeners.add(listener)
      return () => void updateListeners.delete(listener)
    })
  }
  const emitUpdate = (state: UpdateState): void => {
    for (const key of Object.keys(updateState) as (keyof UpdateState)[]) delete updateState[key]
    Object.assign(updateState, state)
    for (const listener of [...updateListeners]) listener({ ...state })
  }
  const mcpConnector = { current: (async () => fakeConnection()) as McpConnector }
  const mcpServers: McpServerConfig[] = []
  const mcpApprovals: McpApproval[] = []
  const mcpConfirm = vi.fn<McpArmDeps['confirmRun']>(async () => true)
  let mcpCounter = 0
  const mcpService = createMcpService({
    manager: armManager,
    settings: {
      getServers: () => mcpServers,
      setServers: (next) => void mcpServers.splice(0, mcpServers.length, ...next),
      getApprovals: () => mcpApprovals,
      setApprovals: (next) => void mcpApprovals.splice(0, mcpApprovals.length, ...next)
    },
    secureStore: armStore,
    connector: (options) => mcpConnector.current(options),
    confirmRun: mcpConfirm,
    newUlid: () => `XXXXXXXXXXXXXXXXXX${String(10_000_000 + mcpCounter++)}`
  })
  const mcpHandlers = createMcpHandlers({ getService: () => mcpService, logError })
  const mcp = {
    list: vi.fn(async () => mcpHandlers.list()),
    add: vi.fn(async (input: unknown) => mcpHandlers.add(input)),
    remove: vi.fn(async (id: unknown) => mcpHandlers.remove(id)),
    reconnect: vi.fn(async (id: unknown) => mcpHandlers.reconnect(id))
  } as unknown as McpSpies
  const armsDeps = { getManager: () => armManager, getCandidates: () => candidateRepo, openExternal: async (url: string) => void opened.push(url), logError }
  const armHandlers = createArmsHandlers(armsDeps)
  const candidateHandlers = createCandidateHandlers(armsDeps)
  const arms = {
    list: vi.fn(async () => armHandlers.list()),
    connect: vi.fn(async (id: unknown) => armHandlers.connect(id)),
    disconnect: vi.fn(async (id: unknown) => armHandlers.disconnect(id)),
    setAutoAccept: vi.fn(async (id: unknown, on: unknown) => armHandlers.setAutoAccept(id, on)),
    setClient: vi.fn(async (id: unknown, client: unknown) => armHandlers.setClient(id, client))
  } as unknown as ArmsSpies
  const candidates = {
    list: vi.fn(async () => candidateHandlers.list()),
    accept: vi.fn(async (id: unknown) => candidateHandlers.accept(id)),
    dismiss: vi.fn(async (id: unknown) => candidateHandlers.dismiss(id)),
    acceptAll: vi.fn(async () => candidateHandlers.acceptAll()),
    dismissAll: vi.fn(async () => candidateHandlers.dismissAll()),
    openSource: vi.fn(async (id: unknown) => candidateHandlers.openSource(id))
  } as unknown as CandidateSpies

  const calendarState: CalendarToday = { configured: true, status: { state: 'off' }, events: [] }
  const calendarHandlers = createCalendarHandlers({
    getProvider: () => ({ today: () => calendarState, findEvent: (id) => calendarState.events.find((e) => e.id === id) }),
    openExternal: async (url) => void opened.push(url),
    logError
  })
  const calendar = {
    today: vi.fn(async () => calendarHandlers.today()),
    openEvent: vi.fn(async (id: unknown) => calendarHandlers.openEvent(id)),
    openWeb: vi.fn(async () => calendarHandlers.openWeb())
  } as unknown as CalendarSpies

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
    listRange: vi.fn(async (from: unknown, to: unknown) => taskHandlers.listRange(from, to)),
    parsePreview: vi.fn(async (text: unknown) => taskHandlers.parsePreview(text))
  } as unknown as TaskSpies

  const routines = {
    list: vi.fn(async () => routineHandlers.list()),
    create: vi.fn(async (input: unknown) => routineHandlers.create(input)),
    update: vi.fn(async (id: unknown, patch: unknown) => routineHandlers.update(id, patch)),
    remove: vi.fn(async (id: unknown) => routineHandlers.remove(id)),
    history: vi.fn(async (days: unknown) => routineHandlers.history(days)),
    move: vi.fn(async (id: unknown, direction: unknown) => routineHandlers.move(id, direction))
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
    candidates: candidates as unknown as CandidatesApi,
    calendar: calendar as unknown as CalendarApi,
    mcp: mcp as unknown as McpApi,
    obsidian: obsidian as unknown as ObsidianApi,
    update: update as unknown as UpdateApi
  }
  Object.defineProperty(window, 'octopus', { value: api, configurable: true, writable: true })

  return { t, routineRepo, memoRepo, settingsRepo, shortcutRepo, platform, tasks, routines, memos, settings, shortcuts, command, arms, candidates, update, updateState, emitUpdate, obsidian, obsidianArm, vault, obsidianConfirm, mcp, mcpService, mcpConfirm, mcpConnector, calendar, calendarState, armManager, candidateRepo, opened, keys, setLlm: (steps) => { const adapter = scripted(steps); llm = adapter; return adapter }, setAdapter: (adapter) => void (llm = adapter), emitCommandEvent }
}

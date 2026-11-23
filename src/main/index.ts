import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { initialViewArgument } from '../shared/initialView'
import { IPC } from '../shared/ipc'
import { localDateString } from '../shared/tasks/dates'
import { buildWebPreferences } from '../shared/securityOptions'
import { openDatabase } from './core/db/connection'
import { runMigrations } from './core/db/migrate'
import { migrations } from './core/db/migrations'
import { createObsidianArm, OBSIDIAN_ID, type ObsidianArm } from './arms/obsidian/arm'
import { createFolderPicker, createGitignoreConfirm } from './platform/obsidianDialogs'
import { createObsidianHandlers, registerObsidianHandlers } from './ipc/obsidian'
import { createMcpService, type McpService } from './arms/mcp/service'
import { sdkConnector } from './arms/mcp/connection'
import { createCommandConfirm } from './platform/commandConfirm'
import { createMcpHandlers, registerMcpHandlers } from './ipc/mcp'
import { createGoogleCalendarArm, GOOGLE_CALENDAR_ID } from './arms/google-calendar'
import { createCalendarProvider, type CalendarProvider } from './arms/google-calendar/provider'
import { createArmSecrets } from './arms/sdk/context'
import { createCalendarHandlers, registerCalendarHandlers } from './ipc/calendar'
import { createArmManager, type ArmManager } from './arms/sdk/manager'
import { createCandidateRepository, type CandidateRepository } from './core/inbox/candidateRepository'
import { createArmsHandlers, createCandidateHandlers, registerArmsHandlers } from './ipc/arms'
import { CAPTURE_ARM_VIEWS, createBrokenExampleArm, createCaptureCalendar, createCaptureMcpConnector, createExampleArm, createMemorySecureStore } from './dev/captureArms'
import type { SecureStore } from './platform/secureStore'
import { createAdapterResolver, type KeyStore } from './core/command/adapterResolver'
import { createConversationRepository, type ConversationRepository } from './core/command/conversationRepository'
import { createCommandSession, type CommandSession } from './core/command/session'
import { createCoreTools } from './core/command/tools/coreTools'
import { createToolRegistry } from './core/command/tools/registry'
import { createChangeBus, type ChangeBus } from './core/changes'
import { notifyOnChange } from './core/tasks/notifying'
import { createMemoRepository, type MemoRepository } from './core/memos/memoRepository'
import { createRoutineRepository, type RoutineRepository } from './core/routines/routineRepository'
import { createSettingsRepository, type SettingsRepository } from './core/settings/settingsRepository'
import { createShortcutRepository, type ShortcutRepository } from './core/shortcuts/shortcutRepository'
import { createTaskRepository, type TaskRepository } from './core/tasks/taskRepository'
import { autoUpdater } from 'electron-updater'
import { createUpdateHandlers, registerUpdateHandlers } from './ipc/update'
import { createUpdateChecker, type UpdateChecker } from './platform/updater'
import { acquireSingleInstance } from './singleInstance'
import { guardWindow } from './windowGuard'
import { cleanupCapture, captureWhenLoaded, prepareCapture } from './dev/capture'
import { createCaptureAdapter, createCaptureKeyStore, seedCaptureCommand } from './dev/captureLlm'
import { createSampleData, seedCaptureSettings } from './dev/captureSupport'
import { createMemoHandlers, registerMemoHandlers } from './ipc/memos'
import { createRoutineHandlers, registerRoutineHandlers } from './ipc/routines'
import { createSettingsHandlers, registerSettingsHandlers } from './ipc/settings'
import { createShortcutHandlers, registerShortcutHandlers } from './ipc/shortcuts'
import { createCommandHandlers, registerCommandHandlers } from './ipc/command'
import { createSafeStorageCipher } from './platform/safeStorageCipher'
import { createSecureStore } from './platform/secureStore'
import { createAnthropicClient, createKeyStore, timedFetch } from './platform/llmClients'
import { createUlidGenerator } from '../shared/tasks/ulid'
import { createShortcutPlatform } from './platform/shortcutPlatform'
import { createTaskHandlers, registerTaskHandlers } from './ipc/tasks'

// 개발용 화면 캡처(OCTOPUS_CAPTURE). userData 를 임시 폴더로 옮기므로 app ready 전에 먼저 부른다.
const captureSession = prepareCapture(app)
// 캡처 때는 소프트웨어 렌더링을 써서, 화면이 잠겨 있거나 가려져 있어도 창을 PNG 로 읽을 수 있게 한다(캡처 모드에서만).
if (captureSession) app.disableHardwareAcceleration()

let database: DatabaseSync | null = null
// DB 를 열지 못하면 null 로 남고, 할 일 IPC 는 db_unavailable 을 돌려준다.
let taskRepository: TaskRepository | null = null
let routineRepository: RoutineRepository | null = null
let memoRepository: MemoRepository | null = null
let settingsRepository: SettingsRepository | null = null
let shortcutRepository: ShortcutRepository | null = null
let conversationRepository: ConversationRepository | null = null
let commandSession: CommandSession | null = null
let candidateRepository: CandidateRepository | null = null
let taskChanges: ChangeBus | null = null
let armManager: ArmManager | null = null
let calendarProvider: CalendarProvider | null = null
let mcpService: McpService | null = null
let obsidianArm: ObsidianArm | null = null
// 자동 업데이트 확인(패키지된 앱에서만 시작할 때 한 번). GitHub Releases, 설치는 사용자가 승인할 때만.
const updateChecker: UpdateChecker = createUpdateChecker({
  isPackaged: app.isPackaged,
  autoUpdater: () => autoUpdater,
  log: (message) => console.warn(`[octopus] ${message}`)
})
// API 키 보관(Electron safeStorage 로 암호화한 파일). app ready 이후에 만든다.
// 개발용 캡처에서는 진짜 보관소 대신 메모리의 가짜를 쓴다(진짜 키를 읽지도 쓰지도 않는다).
let secureStore: SecureStore | null = null
function openSecureStore(): SecureStore {
  secureStore ??= captureSession ? createMemorySecureStore() : createSecureStore(join(app.getPath('userData'), 'secrets.bin'), createSafeStorageCipher())
  return secureStore
}
let keyStore: KeyStore | null = null
function openKeyStore(): KeyStore {
  keyStore ??= captureSession ? createCaptureKeyStore(captureSession.config.view) : createKeyStore(openSecureStore())
  return keyStore
}

function initDatabase(): void {
  try {
    const db = openDatabase(join(app.getPath('userData'), 'octopus.db'))
    try {
      runMigrations(db, migrations)
    } catch (error) {
      db.close()
      throw error
    }
    database = db
    const now = (): Date => new Date()
    // 할 일 변경 알림(옵시디언 내보내기 등이 core 공개 서비스로 구독한다)
    taskChanges = createChangeBus()
    taskRepository = notifyOnChange(createTaskRepository(db, { now }), () => taskChanges?.emit())
    routineRepository = createRoutineRepository(db, { now, tasks: taskRepository })
    memoRepository = createMemoRepository(db, { now, tasks: taskRepository })
    settingsRepository = createSettingsRepository(db)
    shortcutRepository = createShortcutRepository(db, { now })
    // 지시하기: 도구 레지스트리(지금은 코어 도구만) + 세션. 키가 없어도 앱의 나머지는 그대로 동작한다.
    const newId = createUlidGenerator()
    conversationRepository = createConversationRepository(db, { newId: () => newId(Date.now()), now: () => now().toISOString() })
    // Arm: 수신함 후보 저장소와 수명주기 관리자. Arm 이 죽어도 코어는 그대로 동작한다.
    candidateRepository = createCandidateRepository(db, { newId: () => newId(Date.now()), now, tasks: taskRepository })
    const candidates = candidateRepository
    const tasksForArms = taskRepository
    const settingsForArms = settingsRepository
    armManager = createArmManager({
      secureStore: openSecureStore(),
      settings: {
        getConnected: () => settingsForArms.get('arms.connected'),
        setConnected: (ids) => void settingsForArms.set('arms.connected', ids),
        getAutoAccept: () => settingsForArms.get('arms.autoAccept'),
        setAutoAccept: (ids) => void settingsForArms.set('arms.autoAccept', ids)
      },
      coreFor: (armId) => ({
        addInboxCandidate: (candidate) => candidates.add(armId, candidate, { autoAccept: settingsForArms.get('arms.autoAccept').includes(armId) }),
        listTasks: (view) => {
          const day = localDateString(now())
          if (view !== 'today') return tasksForArms.listView(view, day)
          const today = tasksForArms.listView('today', day)
          return [...today.overdue, ...today.today]
        },
        listDoneToday: () => {
          const n = now()
          return tasksForArms.listDoneBetween(new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString(), new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).toISOString())
        },
        onTasksChanged: (listener) => taskChanges?.subscribe(listener) ?? (() => {})
      }),
      http: { fetch: (url, init) => fetch(url, init) },
      logSink: (entry) => console.log(`[octopus] arm:${entry.armId} ${entry.level} ${entry.message}`, entry.data ?? '')
    })
    const arms = armManager
    // Google 캘린더 Arm: 공용 클라이언트는 빌드 때 환경 변수로 주입된 값만 쓴다(캡처에서는 항상 비어 있는 빌드로 본다).
    const googleCalendar = createGoogleCalendarArm({
      clientId: captureSession ? '' : __OCTOPUS_GOOGLE_CLIENT_ID__,
      clientSecret: captureSession ? '' : __OCTOPUS_GOOGLE_CLIENT_SECRET__,
      secrets: createArmSecrets(openSecureStore(), GOOGLE_CALENDAR_ID),
      openExternal: async (url) => {
        if (!/^https:\/\//i.test(url)) throw new Error('refusing to open a non-https address')
        await shell.openExternal(url)
      }
    })
    arms.register(googleCalendar)
    // 옵시디언 Arm: 할 일을 vault 의 파일 하나로 내보낸다(CLAUDE.md 6.3). 폴더 선택·확인 창은 main 의 대화상자만 쓴다.
    const focusedWindow = (): BrowserWindow | null => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    obsidianArm = createObsidianArm({
      config: { get: () => settingsForArms.get('obsidian.config'), set: (next) => void settingsForArms.set('obsidian.config', next) },
      pickFolder: createFolderPicker({ dialog, getWindow: focusedWindow }),
      confirmGitignore: createGitignoreConfirm({ dialog, getWindow: focusedWindow }),
      openExternal: async (url) => {
        if (!url.startsWith('obsidian://open?')) throw new Error('refusing to open an unexpected address')
        await shell.openExternal(url)
      },
      backupDir: join(app.getPath('userData'), 'obsidian-backup'),
      setAutoAcceptDefault: () => void arms.setAutoAccept(OBSIDIAN_ID, true)
    })
    arms.register(obsidianArm)
    // MCP 서버: 서버 하나 = 동적 Arm 하나. 저장된 서버를 등록해 두면 아래 ArmManager.start() 가 이전에 연결돼 있던 것을 조용히 다시 연결한다.
    mcpService = createMcpService({
      manager: arms,
      settings: {
        getServers: () => settingsForArms.get('mcp.servers'),
        setServers: (servers) => void settingsForArms.set('mcp.servers', servers),
        getApprovals: () => settingsForArms.get('mcp.approvals'),
        setApprovals: (approvals) => void settingsForArms.set('mcp.approvals', approvals)
      },
      secureStore: openSecureStore(),
      connector: captureSession ? createCaptureMcpConnector() : sdkConnector,
      // 캡처에서는 확인 창을 띄우지 않는다(진짜 프로그램은 어차피 실행하지 않는다).
      confirmRun: captureSession
        ? async () => true
        : createCommandConfirm({ dialog, getWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null }),
      newUlid: () => newId(Date.now())
    })
    mcpService.init()
    calendarProvider = captureSession?.config.view === 'home' ? createCaptureCalendar() : createCalendarProvider(arms, googleCalendar)
    const coreTools = createCoreTools({ tasks: taskRepository, memos: memoRepository, routines: routineRepository, today: () => localDateString(now()) })
    commandSession = createCommandSession({
      repo: conversationRepository,
      registry: createToolRegistry([() => coreTools, () => arms.tools()]),
      getAdapter: (() => {
        const resolve = createAdapterResolver({
          keys: openKeyStore(),
          models: () => settingsRepository?.get('command.models') ?? [],
          createAnthropicClient,
          fetch: timedFetch
        })
        // 캡처의 "지시하기" 화면만 가짜 모델을 쓴다. 배포된 앱에서는 captureSession 이 항상 null 이다.
        if (captureSession?.config.view !== 'command') return resolve
        const fake = createCaptureAdapter()
        return (modelId: string) => (resolve(modelId), fake)
      })()
    })
    // 앱을 켜면 오늘의 루틴 항목을 보장한다. 실패해도 앱은 계속 뜬다.
    try {
      routineRepository.ensureTodayTasks(localDateString(now()))
    } catch (error) {
      console.error('[octopus] failed to prepare today routine tasks', error)
    }
  } catch (error) {
    // 아직 화면에는 보여 주지 않는다. 로그만 남기고 앱은 계속 뜬다.
    console.error('[octopus] failed to open the database or run migrations', error)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Octopus',
    webPreferences: {
      ...buildWebPreferences(
        join(__dirname, '../preload/index.js'),
        captureSession ? [initialViewArgument(captureSession.config.view)] : []
      ),
      // 캡처 때만: 화면 없이 메모리에 그려서, 화면이 잠겨 있어도 PNG 를 읽을 수 있게 한다.
      ...(captureSession ? { offscreen: true } : {})
    }
  })

  if (captureSession) captureWhenLoaded(win, captureSession, app)

  win.webContents.on('did-finish-load', () => {
    console.log('[octopus] window loaded')
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const indexFilePath = join(__dirname, '../renderer/index.html')
  // 새 창과 앱 밖으로의 이동을 막는다. 바깥 주소는 main 이 검증해서 여는 IPC 로만 열린다.
  guardWindow(win.webContents, { devUrl, indexFilePath })
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(indexFilePath)
  }
}

// 한 번에 하나만 실행: 두 번째 실행은 먼저 떠 있던 창을 앞으로 가져오고 끝난다(같은 DB 를 두 프로세스가 열지 않게). 개발용 캡처는 임시 userData 라 예외.
const primaryInstance = acquireSingleInstance(app, () => BrowserWindow.getAllWindows()[0] ?? null, captureSession !== null)

if (primaryInstance) void app.whenReady().then(async () => {
  initDatabase()
  if (captureSession && taskRepository && routineRepository && memoRepository && shortcutRepository) {
    createSampleData(
      { tasks: taskRepository, routines: routineRepository, memos: memoRepository, shortcuts: shortcutRepository },
      localDateString(new Date()),
      app.getPath('documents')
    )
    if (settingsRepository) seedCaptureSettings(settingsRepository, captureSession.config.view)
  }
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  const logError = (channel: string, error: unknown): void => console.error(`[octopus] ${channel} failed`, error)
  registerTaskHandlers(
    ipcMain,
    createTaskHandlers({
      getRepository: () => taskRepository,
      now: () => new Date(),
      logError,
      ensureRoutineTasks: (today) => void routineRepository?.ensureTodayTasks(today)
    })
  )
  registerRoutineHandlers(
    ipcMain,
    createRoutineHandlers({ getRepository: () => routineRepository, now: () => new Date(), logError })
  )
  registerMemoHandlers(ipcMain, createMemoHandlers({ getRepository: () => memoRepository, now: () => new Date(), logError }))
  registerSettingsHandlers(ipcMain, createSettingsHandlers({ getRepository: () => settingsRepository, logError }))
  const shortcutPlatform = createShortcutPlatform({
    shell,
    dialog,
    getWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    pathExists: existsSync
  })
  registerShortcutHandlers(ipcMain, createShortcutHandlers({ getRepository: () => shortcutRepository, logError, platform: shortcutPlatform }))
  const armsDeps = {
    getManager: () => armManager,
    getCandidates: () => candidateRepository,
    openExternal: (url: string) => shortcutPlatform.openExternal(url),
    logError
  }
  registerArmsHandlers(ipcMain, createArmsHandlers(armsDeps), createCandidateHandlers(armsDeps))
  registerUpdateHandlers(ipcMain, createUpdateHandlers({ getChecker: () => updateChecker }))
  registerObsidianHandlers(ipcMain, createObsidianHandlers({ getArm: () => obsidianArm, logError }))
  registerMcpHandlers(ipcMain, createMcpHandlers({ getService: () => mcpService, logError }))
  registerCalendarHandlers(ipcMain, createCalendarHandlers({ getProvider: () => calendarProvider, openExternal: (url) => shortcutPlatform.openExternal(url), logError }))
  registerCommandHandlers(
    ipcMain,
    createCommandHandlers({
      getSession: () => commandSession,
      getRepository: () => conversationRepository,
      getModels: () => settingsRepository?.get('command.models') ?? [],
      keys: openKeyStore(),
      logError
    })
  )
  if (captureSession && armManager && CAPTURE_ARM_VIEWS.includes(captureSession.config.view)) {
    // 캡처 모드에서만: 가짜 Arm 둘을 등록해 연결한다(하나는 정상, 하나는 오류 상태).
    armManager.register(createExampleArm())
    armManager.register(createBrokenExampleArm())
    await armManager.connect('example')
    await armManager.connect('example-two')
    // 가짜 MCP 서버 둘: 하나는 연결됨(도구 2개), 하나는 실행 실패(오류).
    if (mcpService && (captureSession.config.view === 'arms' || captureSession.config.view === 'arms-mcp')) {
      await mcpService.add({ name: '예시 노트 서버', transport: 'http', url: 'http://localhost:3333/mcp' })
      await mcpService.add({ name: '예시 도구 서버', transport: 'stdio', command: 'missing-server', args: ['--stdio'], env: [{ name: 'EXAMPLE_TOKEN', value: 'capture-value' }] })
    }
  } else if (armManager) {
    // 이전에 연결돼 있던 Arm 을 조용히 다시 연결한다. 기다리지 않고, 실패해도 앱은 그대로 뜬다.
    void armManager.start().catch(() => undefined)
  }
  if (captureSession?.config.view === 'obsidian' && armManager && settingsRepository) {
    // 캡처 전용: 임시 userData 안의 가짜 vault(.obsidian 과 비어 있는 .git 이 있는 폴더)에 연결해 실제 표본 할 일로 내보낸다.
    const vault = join(app.getPath('userData'), 'capture-vault')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    mkdirSync(join(vault, '.git'), { recursive: true })
    const base = settingsRepository.get('obsidian.config')
    settingsRepository.set('obsidian.config', { ...base, vaultPath: vault, mode: 'export', autoAcceptInitialized: true })
    await armManager.connect('obsidian')
  }
  if (captureSession?.config.view === 'command' && commandSession) await seedCaptureCommand(commandSession, 'anthropic-opus')
  createWindow()
  void updateChecker.start() // 패키지된 앱이 아니면 아무것도 하지 않는다. 실패는 조용히 로그만.

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  taskRepository = null
  routineRepository = null
  memoRepository = null
  settingsRepository = null
  shortcutRepository = null
  conversationRepository = null
  commandSession = null
  candidateRepository = null
  taskChanges = null
  armManager?.dispose()
  armManager = null
  calendarProvider = null
  mcpService = null
  obsidianArm = null
  database?.close()
  cleanupCapture(captureSession)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { initialViewArgument } from '../shared/initialView'
import { IPC } from '../shared/ipc'
import { localDateString } from '../shared/tasks/dates'
import { buildWebPreferences } from '../shared/securityOptions'
import { openDatabase } from './core/db/connection'
import { runMigrations } from './core/db/migrate'
import { migrations } from './core/db/migrations'
import { createArmManager, type ArmManager } from './arms/sdk/manager'
import { createCandidateRepository, type CandidateRepository } from './core/inbox/candidateRepository'
import { createArmsHandlers, createCandidateHandlers, registerArmsHandlers } from './ipc/arms'
import { CAPTURE_ARM_VIEWS, createBrokenExampleArm, createExampleArm, createMemorySecureStore } from './dev/captureArms'
import type { SecureStore } from './platform/secureStore'
import { createAdapterResolver, type KeyStore } from './core/command/adapterResolver'
import { createConversationRepository, type ConversationRepository } from './core/command/conversationRepository'
import { createCommandSession, type CommandSession } from './core/command/session'
import { createCoreTools } from './core/command/tools/coreTools'
import { createToolRegistry } from './core/command/tools/registry'
import { createMemoRepository, type MemoRepository } from './core/memos/memoRepository'
import { createRoutineRepository, type RoutineRepository } from './core/routines/routineRepository'
import { createSettingsRepository, type SettingsRepository } from './core/settings/settingsRepository'
import { createShortcutRepository, type ShortcutRepository } from './core/shortcuts/shortcutRepository'
import { createTaskRepository, type TaskRepository } from './core/tasks/taskRepository'
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
let armManager: ArmManager | null = null
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
    taskRepository = createTaskRepository(db, { now })
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
        }
      }),
      http: { fetch: (url, init) => fetch(url, init) },
      logSink: (entry) => console.log(`[octopus] arm:${entry.armId} ${entry.level} ${entry.message}`, entry.data ?? '')
    })
    const arms = armManager
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
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
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
  } else if (armManager) {
    // 이전에 연결돼 있던 Arm 을 조용히 다시 연결한다. 기다리지 않고, 실패해도 앱은 그대로 뜬다.
    void armManager.start().catch(() => undefined)
  }
  if (captureSession?.config.view === 'command' && commandSession) await seedCaptureCommand(commandSession, 'anthropic-opus')
  createWindow()

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
  armManager?.dispose()
  armManager = null
  database?.close()
  cleanupCapture(captureSession)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

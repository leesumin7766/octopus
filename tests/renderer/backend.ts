import { vi, type Mock } from 'vitest'
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
import { createTestRepo, type TestRepo } from '../tasks/helpers'

// React 에게 테스트(act) 환경임을 알린다.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export type TaskSpies = { [K in keyof TasksApi]: Mock<TasksApi[K]> }
export type RoutineSpies = { [K in keyof RoutinesApi]: Mock<RoutinesApi[K]> }
export type MemoSpies = { [K in keyof MemosApi]: Mock<MemosApi[K]> }
export type SettingsSpies = { [K in keyof SettingsApi]: Mock<SettingsApi[K]> }
export type ShortcutSpies = { [K in keyof ShortcutsApi]: Mock<ShortcutsApi[K]> }

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
    shortcuts: shortcuts as unknown as ShortcutsApi
  }
  Object.defineProperty(window, 'octopus', { value: api, configurable: true, writable: true })

  return { t, routineRepo, memoRepo, settingsRepo, shortcutRepo, platform, tasks, routines, memos, settings, shortcuts }
}

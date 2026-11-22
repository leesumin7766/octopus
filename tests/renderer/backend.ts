import { vi, type Mock } from 'vitest'
import { createTaskHandlers } from '../../src/main/ipc/tasks'
import type { OctopusApi } from '../../src/shared/api'
import type { TasksApi } from '../../src/shared/tasks/ipcApi'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

// React 에게 테스트(act) 환경임을 알린다.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export type TaskSpies = { [K in keyof TasksApi]: Mock<TasksApi[K]> }

export interface Backend {
  t: TestRepo
  /** window.octopus.tasks 로 들어가는 함수들. 호출 인자를 확인하거나 결과를 바꿀 수 있다. */
  tasks: TaskSpies
}

/**
 * window.octopus 를 가짜로 넣는다. 가짜의 뒤에는 진짜 IPC 핸들러와 메모리 DB 저장소가 있어서
 * 화면이 보낸 요청이 실제 검증·저장을 거친다. "지금"은 vi 의 가짜 Date 를 따른다.
 */
export function installBackend(): Backend {
  const t = createTestRepo(new Date().toISOString())
  const handlers = createTaskHandlers({
    getRepository: () => t.repo,
    now: () => new Date(),
    logError: () => {}
  })

  const tasks = {
    list: vi.fn(async (view: unknown) => handlers.list(view)),
    quickAdd: vi.fn(async (text: unknown) => handlers.quickAdd(text)),
    create: vi.fn(async (input: unknown) => handlers.create(input)),
    update: vi.fn(async (id: unknown, patch: unknown) => handlers.update(id, patch)),
    setStatus: vi.fn(async (id: unknown, status: unknown) => handlers.setStatus(id, status)),
    remove: vi.fn(async (id: unknown) => handlers.remove(id)),
    reorder: vi.fn(async (ids: unknown) => handlers.reorder(ids)),
    moveToToday: vi.fn(async (ids: unknown) => handlers.moveToToday(ids)),
    moveToSomeday: vi.fn(async (ids: unknown) => handlers.moveToSomeday(ids)),
    reschedule: vi.fn(async (ids: unknown, date: unknown) => handlers.reschedule(ids, date)),
    parsePreview: vi.fn(async (text: unknown) => handlers.parsePreview(text))
  } as unknown as TaskSpies

  const api: OctopusApi = {
    getAppVersion: async () => '0.0.0-test',
    initialView: null,
    tasks: tasks as unknown as TasksApi
  }
  Object.defineProperty(window, 'octopus', { value: api, configurable: true, writable: true })

  return { t, tasks }
}

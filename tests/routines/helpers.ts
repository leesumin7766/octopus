import { createRoutineRepository, type RoutineRepository } from '../../src/main/core/routines/routineRepository'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

export interface RoutineEnv {
  t: TestRepo
  routines: RoutineRepository
  /** 할 일 저장소와 루틴 저장소의 시계를 함께 옮긴다. */
  setNow(iso: string): void
}

/** 로컬 정오. 어느 시간대에서도 로컬 날짜가 y-m-d 가 된다. */
export function localNoon(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString()
}

export function createRoutineEnv(startIso = localNoon(2026, 3, 10)): RoutineEnv {
  const t = createTestRepo(startIso)
  let now = new Date(startIso)
  const routines = createRoutineRepository(t.db, { now: () => now, tasks: t.repo })
  return {
    t,
    routines,
    setNow(iso) {
      now = new Date(iso)
      t.setNow(iso)
    }
  }
}

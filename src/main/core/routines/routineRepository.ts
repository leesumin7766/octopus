import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
  type Routine,
  type RoutineCell,
  type RoutineHistory,
  type RoutineInput,
  type RoutinePatch
} from '../../../shared/routines/types'
import type { MoveDirection } from '../../../shared/shortcuts/types'
import type { Task } from '../../../shared/tasks/types'
import { addDays, localDateString, weekdayOf } from '../../../shared/tasks/dates'
import { createUlidGenerator } from '../../../shared/tasks/ulid'
import { isValidDateString } from '../../../shared/validation/task'
import { normalizeDays, RoutineValidationError, validateRoutineFields } from '../../../shared/validation/routine'
import { withTransaction } from '../db/transaction'
import { EntityNotFoundError } from '../errors'
import type { TaskRepository } from '../tasks/taskRepository'
import { rowToTask, SELECT_TASKS } from '../tasks/taskRows'

export class RoutineNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('routine', id)
    this.name = 'RoutineNotFoundError'
  }
}

export interface RoutineRepositoryDeps {
  /** 현재 시각. 안에서 new Date() 를 직접 부르지 않도록 바깥에서 넣는다. */
  now: () => Date
  /** 오늘의 루틴 항목은 일반 할 일로 만든다. */
  tasks: TaskRepository
}

export interface RoutineRepository {
  list(): Routine[]
  get(id: string): Routine | undefined
  /** today 는 YYYY-MM-DD. 만든 뒤 오늘 항목도 바로 보장한다. */
  create(input: RoutineInput, today: string): Routine
  update(id: string, patch: RoutinePatch, today: string): Routine
  /** 루틴과 오늘 이후의 미완료 항목만 지운다. 지난 기록(할 일)은 남긴다. */
  remove(id: string, today: string): boolean
  /** 오늘 해당하는 active 루틴마다 오늘 항목이 없을 때만 만든다(여러 번 불러도 하나). 만든 개수를 돌려준다. 오늘을 "앱을 켠 날"로 기록한다. */
  ensureTodayTasks(today: string): number
  /** 루틴을 위(-1) 또는 아래(+1)로 한 칸 옮긴다. 맨 위·아래면 아무 일도 없다. */
  move(id: string, direction: MoveDirection): void
  /** 오늘 날짜의 루틴 항목(완료한 것 포함, 취소한 것 제외) */
  todayItems(today: string): Task[]
  /** 오늘까지 최근 days 일(기본 14)의 루틴별 날짜 → 완료 여부 */
  history(today: string, days?: number): RoutineHistory
}

const SELECT_ROUTINES = `
  SELECT id, title, days, active, sort_order AS "order", created_at AS createdAt, updated_at AS updatedAt
  FROM routines`

interface RawRoutineRow {
  id: string
  title: string
  days: string
  active: number
  order: number
  createdAt: string
  updatedAt: string
}

function rowToRoutine(row: unknown): Routine {
  const raw = row as RawRoutineRow
  return {
    id: raw.id,
    title: raw.title,
    days: JSON.parse(raw.days) as number[],
    active: raw.active === 1,
    order: raw.order,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  }
}

function assertDate(field: string, value: unknown): asserts value is string {
  if (!isValidDateString(value)) {
    throw new RoutineValidationError([{ field, message: 'must be an existing date in YYYY-MM-DD' }])
  }
}

function assertValidFields(candidate: Record<'title' | 'days' | 'active', unknown>): Pick<Routine, 'title' | 'days' | 'active'> {
  const issues = validateRoutineFields(candidate)
  if (issues.length > 0) throw new RoutineValidationError(issues)
  return candidate as Pick<Routine, 'title' | 'days' | 'active'>
}

function isDueOn(routine: Pick<Routine, 'active' | 'days'>, date: string): boolean {
  return routine.active && routine.days.includes(weekdayOf(date))
}

/** 칸 계산에 쓰는 말이 아니라 저장된 상태 → 칸 종류. 기록이 없는 날의 판단은 history 가 한다. */
function cellFor(status: string | undefined, date: string, today: string): RoutineCell | null {
  if (status === 'done') return 'done'
  if (status === 'open') return date < today ? 'missed' : 'pending'
  if (status === 'canceled') return 'none'
  return null
}

export function createRoutineRepository(db: DatabaseSync, deps: RoutineRepositoryDeps): RoutineRepository {
  const nextId = createUlidGenerator()

  function get(id: string): Routine | undefined {
    const row = db.prepare(`${SELECT_ROUTINES} WHERE id = ?`).get(id)
    return row === undefined ? undefined : rowToRoutine(row)
  }

  function mustGet(id: string): Routine {
    const routine = get(id)
    if (!routine) throw new RoutineNotFoundError(id)
    return routine
  }

  function list(): Routine[] {
    return db
      .prepare(`${SELECT_ROUTINES} ORDER BY sort_order, created_at, id`)
      .all()
      .map(rowToRoutine)
  }

  function ensureTodayTasks(today: string): number {
    assertDate('today', today)

    return withTransaction(db, () => {
      db.prepare('INSERT OR IGNORE INTO routine_open_days (date) VALUES (?)').run(today)
      const exists = db.prepare('SELECT 1 AS found FROM tasks WHERE routine_id = ? AND date = ?')
      let created = 0
      for (const routine of list()) {
        if (!isDueOn(routine, today)) continue
        if (exists.get(routine.id, today) !== undefined) continue
        deps.tasks.create({ title: routine.title, bucket: 'scheduled', date: today, routineId: routine.id })
        created++
      }
      return created
    })
  }

  /** 루틴을 바꾼 뒤 오늘 이후의 미완료 항목을 새 설정에 맞춘다. */
  function reconcile(routine: Routine, titleChanged: boolean, today: string): void {
    if (!isDueOn(routine, today)) {
      // 끄거나 오늘 요일에서 빠졌으면 오늘 이후의 미완료 항목은 없앤다. 완료한 기록은 남는다.
      db.prepare("DELETE FROM tasks WHERE routine_id = ? AND date >= ? AND status = 'open'").run(routine.id, today)
    } else if (titleChanged) {
      db.prepare("UPDATE tasks SET title = ?, updated_at = ? WHERE routine_id = ? AND date >= ? AND status = 'open'").run(
        routine.title,
        deps.now().toISOString(),
        routine.id,
        today
      )
    }
  }

  return {
    list,
    get,

    create(input, today) {
      assertDate('today', today)
      const now = deps.now()
      const iso = now.toISOString()
      const fields = assertValidFields({
        title: typeof input.title === 'string' ? input.title.trim() : input.title,
        days: normalizeDays(input.days),
        active: input.active ?? true
      })

      return withTransaction(db, () => {
        const id = nextId(now.getTime())
        db.prepare(
          `INSERT INTO routines (id, title, days, active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM routines), ?, ?)`
        ).run(id, fields.title, JSON.stringify(fields.days), fields.active ? 1 : 0, iso, iso)
        ensureTodayTasks(today)
        return mustGet(id)
      })
    },

    update(id, patch, today) {
      assertDate('today', today)
      const existing = mustGet(id)
      const fields = assertValidFields({
        title: typeof patch.title === 'string' ? patch.title.trim() : (patch.title ?? existing.title),
        days: patch.days !== undefined ? normalizeDays(patch.days) : existing.days,
        active: patch.active ?? existing.active
      })

      return withTransaction(db, () => {
        db.prepare('UPDATE routines SET title = ?, days = ?, active = ?, updated_at = ? WHERE id = ?').run(
          fields.title,
          JSON.stringify(fields.days),
          fields.active ? 1 : 0,
          deps.now().toISOString(),
          id
        )
        const updated = mustGet(id)
        reconcile(updated, updated.title !== existing.title, today)
        ensureTodayTasks(today)
        return updated
      })
    },

    remove(id, today) {
      assertDate('today', today)
      return withTransaction(db, () => {
        if (get(id) === undefined) return false
        db.prepare("DELETE FROM tasks WHERE routine_id = ? AND date >= ? AND status = 'open'").run(id, today)
        db.prepare('DELETE FROM routines WHERE id = ?').run(id)
        return true
      })
    },

    ensureTodayTasks,

    move(id, direction) {
      withTransaction(db, () => {
        const all = list()
        const index = all.findIndex((routine) => routine.id === id)
        if (index < 0) throw new RoutineNotFoundError(id)
        const other = all[direction === 'up' ? index - 1 : index + 1]
        if (!other) return
        const update = db.prepare('UPDATE routines SET sort_order = ? WHERE id = ?')
        update.run(other.order, id)
        update.run(all[index].order, other.id)
      })
    },

    todayItems(today) {
      assertDate('today', today)
      return db
        .prepare(
          `${SELECT_TASKS} WHERE routine_id IS NOT NULL AND date = ? AND status != 'canceled'
           ORDER BY (SELECT sort_order FROM routines WHERE routines.id = tasks.routine_id), created_at, id`
        )
        .all(today)
        .map(rowToTask)
    },

    history(today, days = DEFAULT_HISTORY_DAYS) {
      assertDate('today', today)
      if (!Number.isInteger(days) || days < 1 || days > MAX_HISTORY_DAYS) {
        throw new RoutineValidationError([{ field: 'days', message: `must be an integer 1-${MAX_HISTORY_DAYS}` }])
      }

      const start = addDays(today, -(days - 1))
      const dates = Array.from({ length: days }, (_, i) => addDays(start, i))

      const rows = db
        .prepare(
          `SELECT routine_id AS routineId, date, status FROM tasks
           WHERE routine_id IS NOT NULL AND date >= ? AND date <= ?`
        )
        .all(start, today) as { routineId: string; date: string; status: string }[]
      const state = new Map(rows.map((row) => [`${row.routineId}|${row.date}`, row.status]))
      const openDays = new Set(
        (db.prepare('SELECT date FROM routine_open_days WHERE date >= ? AND date <= ?').all(start, today) as { date: string }[]).map(
          (row) => row.date
        )
      )

      return {
        dates,
        routines: list().map((routine) => {
          // 루틴이 만들어지기 전 날은 "해당 없음"이다(앱을 안 켠 날이 아니다).
          const createdDay = localDateString(new Date(routine.createdAt))
          return {
            id: routine.id,
            title: routine.title,
            active: routine.active,
            days: routine.days,
            cells: dates.map((date): RoutineCell => {
              const fromTask = cellFor(state.get(`${routine.id}|${date}`), date, today)
              if (fromTask !== null) return fromTask
              if (date > today || date < createdDay) return 'none'
              if (!isDueOn(routine, date)) return 'none'
              if (date === today) return 'pending'
              // 해당하는 날인데 항목이 없다: 그날 앱을 켰다면 못 한 것, 아니면 앱을 안 켠 날.
              return openDays.has(date) ? 'missed' : 'closed'
            })
          }
        })
      }
    }
  }
}

import type { DatabaseSync } from 'node:sqlite'
import {
  TASK_FIELD_KEYS,
  type Task,
  type TaskFields,
  type TaskInput,
  type TaskStatus,
  type TaskView,
  type TodayView
} from '../../../shared/tasks/types'
import { addDays, diffDays, localDateString } from '../../../shared/tasks/dates'
import { nextOccurrenceFrom } from '../../../shared/tasks/repeat'
import { createUlidGenerator } from '../../../shared/tasks/ulid'
import {
  dateRangeIssues,
  isValidDateString,
  TaskValidationError,
  validateTaskFields
} from '../../../shared/validation/task'
import { withTransaction } from '../db/transaction'
import { EntityNotFoundError } from '../errors'
import { rowToTask, SELECT_TASKS } from './taskRows'

export class TaskNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('task', id)
    this.name = 'TaskNotFoundError'
  }
}

export interface TaskRepositoryDeps {
  /** 현재 시각. 안에서 new Date() 를 직접 부르지 않도록 바깥에서 넣는다. */
  now: () => Date
}

export interface TaskRepository {
  create(input: TaskInput): Task
  get(id: string): Task | undefined
  update(id: string, patch: Partial<TaskFields>): Task
  setStatus(id: string, status: TaskStatus): Task
  remove(id: string): boolean
  /** ids 의 순서대로 보이도록, 이 항목들이 가진 order 값끼리만 자리를 바꾼다. */
  reorder(ids: readonly string[]): void
  listView(view: 'today', today: string): TodayView
  listView(view: Exclude<TaskView, 'today'>, today: string): Task[]
  /**
   * from..to(양 끝 포함) 사이 날짜(Task.date)를 가진 할 일. 열린 것과 끝난 것을 모두 주고 취소는 뺀다.
   * 날짜 → 시간 없음 뒤(시간 있는 것은 시간순) → 만든 순서. 읽기만 한다(루틴 생성 등 부수 효과 없음).
   */
  listRange(from: string, to: string): Task[]
  moveToToday(ids: readonly string[], today: string): Task[]
  moveToSomeday(ids: readonly string[]): Task[]
  reschedule(ids: readonly string[], date: string): Task[]
  /** 완료 시각(done_at, ISO)이 [fromIso, toIso) 안인 끝난 할 일 — 루틴 항목도 포함한다(완료 보기와 달리). 오래된 것부터. */
  listDoneBetween(fromIso: string, toIso: string): Task[]
  /** 안 하기로 함(canceled) 할 일. done_at 이 없으므로 updatedAt(안 하기로 한 시각) 이 새로운 것부터. 완료 보기의 별도 거르기에서만 쓴다. */
  listCanceled(): Task[]
}

const STATUSES: readonly unknown[] = ['open', 'done', 'canceled']
const ORDER_BY = 'ORDER BY sort_order, created_at, id'

function invalid(field: string, message: string): TaskValidationError {
  return new TaskValidationError([{ field, message }])
}

function assertDate(field: string, value: unknown): asserts value is string {
  if (!isValidDateString(value)) throw invalid(field, 'must be an existing date in YYYY-MM-DD')
}

/** 검증 전에 하는 정리: 제목 앞뒤 공백 제거. */
function withTrimmedTitle(fields: Record<string, unknown>): Record<string, unknown> {
  return typeof fields['title'] === 'string' ? { ...fields, title: fields['title'].trim() } : fields
}

function assertValidFields(candidate: Record<string, unknown>): TaskFields {
  const issues = validateTaskFields(candidate as Record<keyof TaskFields, unknown>)
  if (issues.length > 0) throw new TaskValidationError(issues)
  return candidate as unknown as TaskFields
}

function fieldParams(f: TaskFields): (string | number | null)[] {
  return [
    f.title,
    f.notes,
    f.bucket,
    f.date,
    f.time,
    f.deadline,
    f.priority,
    f.project,
    JSON.stringify(f.tags),
    f.repeat === null ? null : JSON.stringify(f.repeat),
    f.routineId,
    f.source === null ? null : JSON.stringify(f.source)
  ]
}

export function createTaskRepository(db: DatabaseSync, deps: TaskRepositoryDeps): TaskRepository {
  const nextId = createUlidGenerator()

  function get(id: string): Task | undefined {
    const row = db.prepare(`${SELECT_TASKS} WHERE id = ?`).get(id)
    return row === undefined ? undefined : rowToTask(row)
  }

  function mustGet(id: string): Task {
    const task = get(id)
    if (!task) throw new TaskNotFoundError(id)
    return task
  }

  function query(where: string, ...params: string[]): Task[] {
    return db
      .prepare(`${SELECT_TASKS} WHERE ${where}`)
      .all(...params)
      .map(rowToTask)
  }

  /** 새 할 일 한 줄을 넣고 id 를 돌려준다. order 는 맨 끝, status 는 open. */
  function insertTask(fields: TaskFields, now: Date): string {
    const iso = now.toISOString()
    const id = nextId(now.getTime())
    db.prepare(
      `INSERT INTO tasks (title, notes, bucket, date, time, deadline, priority, project, tags, repeat,
                          routine_id, source, id, status, sort_order, created_at, updated_at, done_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open',
               (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks), ?, ?, NULL)`
    ).run(...fieldParams(fields), id, iso, iso)
    return id
  }

  /** 반복하는 할 일을 끝냈을 때 다음 회차를 새 할 일로 만든다. 실패하면 던진다(호출한 트랜잭션이 되돌림). */
  function insertNextOccurrence(done: Task, now: Date): void {
    if (done.repeat === null || done.date === null) throw new Error('task has no repeat rule or date')

    // 원래 날짜보다 뒤이면서 오늘(로컬 날짜) 이상인 첫 회차
    const date = nextOccurrenceFrom(done.repeat, done.date, localDateString(now))
    // 마감일은 날짜가 밀린 만큼 같이 민다.
    const deadline = done.deadline === null ? null : addDays(done.deadline, diffDays(date, done.date))
    const fields = assertValidFields({
      title: done.title,
      notes: done.notes,
      bucket: 'scheduled',
      date,
      time: done.time,
      deadline,
      priority: done.priority,
      project: done.project,
      tags: done.tags,
      repeat: done.repeat,
      routineId: done.routineId,
      source: done.source
    })
    insertTask(fields, now)
  }

  /**
   * 반복 할 일의 완료를 되돌릴 때, 그 완료로 생긴 다음 회차가 아직 손대지 않은 상태면 지운다.
   * 같은 now() 로 찍혔으므로 createdAt 이 원래 할 일의 doneAt 과 같고, 손대지 않았으면
   * updatedAt 이 createdAt 과 같다. 고쳤거나 이미 완료한 회차는 그대로 둔다.
   */
  function removeUntouchedNextOccurrence(done: Task): void {
    if (done.doneAt === null || done.repeat === null) return

    const repeat = JSON.stringify(done.repeat)
    const candidates = query("status = 'open' AND created_at = ? AND updated_at = created_at", done.doneAt)
    for (const candidate of candidates) {
      if (candidate.id === done.id || candidate.title !== done.title) continue
      if (JSON.stringify(candidate.repeat) !== repeat) continue
      db.prepare('DELETE FROM tasks WHERE id = ?').run(candidate.id)
    }
  }

  /**
   * ids 전체를 한 트랜잭션으로 고친다. 하나라도 없거나 guard 가 던지면 전부 되돌린다.
   * guard 는 고치기 전의 할 일을 받아 허용되지 않으면 예외를 던진다.
   */
  function bulkUpdate(
    ids: readonly string[],
    setSql: string,
    setParams: string[],
    guard?: (task: Task) => void
  ): Task[] {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return []

    const updatedAt = deps.now().toISOString()
    withTransaction(db, () => {
      const statement = db.prepare(`UPDATE tasks SET ${setSql}, updated_at = ? WHERE id = ?`)
      for (const id of unique) {
        if (guard) guard(mustGet(id))
        if (Number(statement.run(...setParams, updatedAt, id).changes) !== 1) throw new TaskNotFoundError(id)
      }
    })
    return unique.map(mustGet)
  }

  function listView(view: 'today', today: string): TodayView
  function listView(view: Exclude<TaskView, 'today'>, today: string): Task[]
  function listView(view: TaskView, today: string): TodayView | Task[] {
    assertDate('today', today)

    switch (view) {
      case 'inbox':
        return query(`status = 'open' AND bucket = 'inbox' ${ORDER_BY}`)
      case 'today': {
        const tasks = query(`status = 'open' AND date <= ? ${ORDER_BY}`, today)
        return {
          // 루틴에서 생긴 지난 항목은 "지난 할 일"이 아니라 기록으로만 남긴다.
          overdue: tasks.filter((t) => (t.date as string) < today && t.routineId === null),
          today: tasks.filter((t) => t.date === today)
        }
      }
      case 'upcoming':
        return query(
          `status = 'open' AND bucket = 'scheduled' AND date > ? ORDER BY date, sort_order, created_at, id`,
          today
        )
      case 'someday':
        return query(`status = 'open' AND bucket = 'someday' ${ORDER_BY}`)
      case 'done':
        // 루틴 기록은 완료 보기가 아니라 체크리스트 화면(기록 격자)에서만 본다.
        return query(`status = 'done' AND routine_id IS NULL ORDER BY done_at DESC, sort_order, created_at, id`)
    }
  }

  return {
    listRange(from, to) {
      const issues = dateRangeIssues(from, to)
      if (issues.length > 0) throw new TaskValidationError(issues)
      return query(
        `status IN ('open', 'done') AND date BETWEEN ? AND ?
         ORDER BY date, time IS NULL, time, sort_order, created_at, id`,
        from,
        to
      )
    },

    listCanceled() {
      return query(`status = 'canceled' ORDER BY updated_at DESC, sort_order, created_at, id`)
    },

    listDoneBetween(fromIso, toIso) {
      return query(`status = 'done' AND done_at >= ? AND done_at < ? ORDER BY done_at, sort_order, id`, fromIso, toIso)
    },

    create(input) {
      const now = deps.now()
      const date = input.date ?? null
      const fields = assertValidFields(
        withTrimmedTitle({
          title: input.title,
          notes: input.notes ?? '',
          bucket: input.bucket ?? (date === null ? 'inbox' : 'scheduled'),
          date,
          time: input.time ?? null,
          deadline: input.deadline ?? null,
          priority: input.priority ?? 0,
          project: input.project ?? null,
          tags: input.tags ?? [],
          repeat: input.repeat ?? null,
          routineId: input.routineId ?? null,
          source: input.source ?? null
        })
      )

      return mustGet(insertTask(fields, now))
    },

    get,

    update(id, patch) {
      const existing = mustGet(id)
      const candidate: Record<string, unknown> = {}
      for (const key of TASK_FIELD_KEYS) candidate[key] = patch[key] !== undefined ? patch[key] : existing[key]
      const fields = assertValidFields(withTrimmedTitle(candidate))

      db.prepare(
        `UPDATE tasks SET title = ?, notes = ?, bucket = ?, date = ?, time = ?, deadline = ?, priority = ?,
                          project = ?, tags = ?, repeat = ?, routine_id = ?, source = ?, updated_at = ?
         WHERE id = ?`
      ).run(...fieldParams(fields), deps.now().toISOString(), id)
      return mustGet(id)
    },

    setStatus(id, status) {
      if (!STATUSES.includes(status)) throw invalid('status', 'must be open, done or canceled')

      const existing = mustGet(id)
      const now = deps.now()
      const iso = now.toISOString()
      // done 일 때만 완료 시각을 기록한다. 이미 done 이면 처음 시각을 유지한다.
      const doneAt = status === 'done' ? (existing.doneAt ?? iso) : null

      withTransaction(db, () => {
        db.prepare('UPDATE tasks SET status = ?, done_at = ?, updated_at = ? WHERE id = ?').run(
          status,
          doneAt,
          iso,
          id
        )
        if (existing.repeat !== null) {
          if (status === 'done' && existing.status !== 'done') {
            // 반복하는 할 일이 새로 done 이 되면 다음 회차를 같은 트랜잭션에서 만든다.
            insertNextOccurrence(existing, now)
          } else if (status === 'open' && existing.status === 'done') {
            // 완료를 되돌리면 그때 생긴 손대지 않은 회차를 지워 중복을 막는다.
            removeUntouchedNextOccurrence(existing)
          }
        }
      })
      return mustGet(id)
    },

    remove(id) {
      return Number(db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes) === 1
    },

    reorder(ids) {
      if (new Set(ids).size !== ids.length) throw invalid('ids', 'must not contain duplicates')
      if (ids.length < 2) return

      const updatedAt = deps.now().toISOString()
      withTransaction(db, () => {
        const select = db.prepare('SELECT sort_order AS o FROM tasks WHERE id = ?')
        const current = ids.map((id) => {
          const row = select.get(id) as { o: number } | undefined
          if (!row) throw new TaskNotFoundError(id)
          return row.o
        })
        const slots = [...current].sort((a, b) => a - b)

        const update = db.prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ?')
        ids.forEach((id, index) => {
          if (current[index] !== slots[index]) update.run(slots[index], updatedAt, id)
        })
      })
    },

    listView,

    moveToToday(ids, today) {
      assertDate('today', today)
      return bulkUpdate(ids, "bucket = 'scheduled', date = ?", [today])
    },

    moveToSomeday(ids) {
      // 날짜가 없어지므로 시각도 함께 비운다. 반복하는 할 일은 날짜가 필요하므로 옮기지 않는다.
      return bulkUpdate(ids, "bucket = 'someday', date = NULL, time = NULL", [], (task) => {
        if (task.repeat !== null) throw invalid('repeat', 'a repeating task cannot be moved to someday')
        if (task.routineId !== null) throw invalid('routineId', 'a routine task cannot be moved to someday')
      })
    },

    reschedule(ids, date) {
      assertDate('date', date)
      return bulkUpdate(ids, "bucket = 'scheduled', date = ?", [date])
    }
  }
}

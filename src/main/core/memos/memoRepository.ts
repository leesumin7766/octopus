import type { DatabaseSync } from 'node:sqlite'
import type { Memo } from '../../../shared/memos/types'
import { parseQuickInput } from '../../../shared/tasks/quickParse'
import type { Task } from '../../../shared/tasks/types'
import { createUlidGenerator } from '../../../shared/tasks/ulid'
import { MemoValidationError, validateMemoBody } from '../../../shared/validation/memo'
import { isValidDateString } from '../../../shared/validation/task'
import { withTransaction } from '../db/transaction'
import { EntityNotFoundError } from '../errors'
import type { TaskRepository } from '../tasks/taskRepository'

export class MemoNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('memo', id)
    this.name = 'MemoNotFoundError'
  }
}

export interface MemoRepositoryDeps {
  /** 현재 시각. 안에서 new Date() 를 직접 부르지 않도록 바깥에서 넣는다. */
  now: () => Date
  /** 메모를 할 일로 만들 때 쓴다. */
  tasks: TaskRepository
}

export interface MemoRepository {
  /** 본문은 마크다운 원문 그대로 저장한다. */
  create(body: string): Memo
  get(id: string): Memo | undefined
  update(id: string, body: string): Memo
  remove(id: string): boolean
  /** 고정한 메모 먼저, 그 안에서는 수정 시각이 최신인 순서 */
  list(): Memo[]
  /** 본문에 query 가 들어 있는 메모(부분 일치). 빈 검색어면 전부. 정렬은 list 와 같다. */
  search(query: string): Memo[]
  togglePin(id: string): Memo
  /** 첫 줄(최대 200자)을 제목으로, 나머지를 메모로 해서 할 일을 만들고 메모에 연결한다. */
  toTask(id: string, today: string): { memo: Memo; task: Task }
}

/** 할 일 제목으로 쓸 첫 줄의 최대 길이(글자 수) */
export const MAX_TITLE_FROM_MEMO = 200

const SELECT_MEMOS = `
  SELECT id, body, pinned, task_id AS taskId, created_at AS createdAt, updated_at AS updatedAt
  FROM memos`
const ORDER = 'ORDER BY pinned DESC, updated_at DESC, id DESC'

interface RawMemoRow {
  id: string
  body: string
  pinned: number
  taskId: string | null
  createdAt: string
  updatedAt: string
}

function rowToMemo(row: unknown): Memo {
  const raw = row as RawMemoRow
  return {
    id: raw.id,
    body: raw.body,
    pinned: raw.pinned === 1,
    taskId: raw.taskId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  }
}

function assertBody(body: unknown): asserts body is string {
  const issues = validateMemoBody(body)
  if (issues.length > 0) throw new MemoValidationError(issues)
}

/** 메모를 제목(첫 줄, 최대 200자)과 notes(나머지)로 나눈다. 200자를 넘는 부분은 notes 맨 앞으로 간다. */
export function splitMemoForTask(body: string): { title: string; notes: string } {
  const text = body.trim()
  const newline = text.indexOf('\n')
  const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim()
  const rest = newline === -1 ? '' : text.slice(newline + 1).trim()

  const overflow = firstLine.slice(MAX_TITLE_FROM_MEMO)
  const notes = overflow ? (rest ? `${overflow}\n${rest}` : overflow) : rest
  return { title: firstLine.slice(0, MAX_TITLE_FROM_MEMO), notes }
}

/** LIKE 에서 %·_ 가 글자 그대로 검색되도록 escape 문자(!)를 붙인다. */
function likePattern(query: string): string {
  return `%${query.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`
}

export function createMemoRepository(db: DatabaseSync, deps: MemoRepositoryDeps): MemoRepository {
  const nextId = createUlidGenerator()

  function get(id: string): Memo | undefined {
    const row = db.prepare(`${SELECT_MEMOS} WHERE id = ?`).get(id)
    return row === undefined ? undefined : rowToMemo(row)
  }

  function mustGet(id: string): Memo {
    const memo = get(id)
    if (!memo) throw new MemoNotFoundError(id)
    return memo
  }

  function list(): Memo[] {
    return db.prepare(`${SELECT_MEMOS} ${ORDER}`).all().map(rowToMemo)
  }

  return {
    get,
    list,

    create(body) {
      assertBody(body)
      const now = deps.now()
      const iso = now.toISOString()
      const id = nextId(now.getTime())
      db.prepare('INSERT INTO memos (id, body, pinned, task_id, created_at, updated_at) VALUES (?, ?, 0, NULL, ?, ?)').run(
        id,
        body,
        iso,
        iso
      )
      return mustGet(id)
    },

    update(id, body) {
      assertBody(body)
      const existing = mustGet(id)
      // 바뀐 게 없으면 수정 시각도 그대로 둔다(목록 순서가 괜히 바뀌지 않게).
      if (existing.body === body) return existing

      db.prepare('UPDATE memos SET body = ?, updated_at = ? WHERE id = ?').run(body, deps.now().toISOString(), id)
      return mustGet(id)
    },

    remove(id) {
      return Number(db.prepare('DELETE FROM memos WHERE id = ?').run(id).changes) === 1
    },

    search(query) {
      const trimmed = typeof query === 'string' ? query.trim() : ''
      if (trimmed === '') return list()
      return db
        .prepare(`${SELECT_MEMOS} WHERE body LIKE ? ESCAPE '!' ${ORDER}`)
        .all(likePattern(trimmed))
        .map(rowToMemo)
    },

    togglePin(id) {
      const existing = mustGet(id)
      // 고정은 "고친 것"이 아니라서 수정 시각은 건드리지 않는다.
      db.prepare('UPDATE memos SET pinned = ? WHERE id = ?').run(existing.pinned ? 0 : 1, id)
      return mustGet(id)
    },

    toTask(id, today) {
      if (!isValidDateString(today)) {
        throw new MemoValidationError([{ field: 'today', message: 'must be an existing date in YYYY-MM-DD' }])
      }

      return withTransaction(db, () => {
        const memo = mustGet(id)
        if (memo.taskId !== null) {
          throw new MemoValidationError([{ field: 'taskId', message: 'memo already has a task' }])
        }

        const { title, notes } = splitMemoForTask(memo.body)
        const parsed = parseQuickInput(title, today)
        const task = deps.tasks.create({
          title: parsed.title,
          notes,
          date: parsed.date,
          time: parsed.time,
          project: parsed.project,
          priority: parsed.priority,
          repeat: parsed.repeat,
          bucket: parsed.bucket
        })

        db.prepare('UPDATE memos SET task_id = ? WHERE id = ?').run(task.id, id)
        return { memo: mustGet(id), task }
      })
    }
  }
}

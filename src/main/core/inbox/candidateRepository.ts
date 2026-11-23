import type { DatabaseSync } from 'node:sqlite'
import type { CandidateInput, InboxCandidate } from '../../../shared/arms/types'
import type { Task } from '../../../shared/tasks/types'
import { FieldValidationError, type ValidationIssue } from '../../../shared/validation/issues'
import { parseShortcutUrl } from '../../../shared/validation/shortcut'
import { isValidDateString } from '../../../shared/validation/task'
import { EntityNotFoundError } from '../errors'
import { withTransaction } from '../db/transaction'
import type { TaskRepository } from '../tasks/taskRepository'

export class CandidateNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('candidate', id)
  }
}

export class CandidateValidationError extends FieldValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('candidate', issues)
  }
}

export interface AddResult {
  /** 새로 들어갔는지. 같은 (arm, ref) 가 이미 있으면(무시했거나 이미 넣은 것 포함) false */
  added: boolean
  /** 자동 수락으로 바로 수신함 할 일이 됐는지 */
  accepted: boolean
}

export interface CandidateRepository {
  /** Arm 이 보내 온 후보를 넣는다. 같은 원본은 중복 없이, 무시한 것은 다시 나타나지 않게. autoAccept 면 한 트랜잭션으로 수신함에 넣는다. */
  add(armId: string, input: CandidateInput, options?: { autoAccept?: boolean }): AddResult
  /** 아직 처리하지 않은 후보(오래된 것부터) */
  listPending(): InboxCandidate[]
  get(id: string): InboxCandidate | undefined
  /** 수신함 할 일을 만들고 accepted 로 바꾼다(한 트랜잭션). 이미 처리된 후보면 EntityNotFoundError. */
  accept(id: string): Task
  dismiss(id: string): void
  acceptAll(): number
  dismissAll(): number
}

interface Row {
  id: string
  arm_id: string
  ref: string
  title: string
  notes: string
  url: string | null
  due_date: string | null
  created_at: string
  status: InboxCandidate['status']
}

const toCandidate = (r: Row): InboxCandidate => ({
  id: r.id,
  armId: r.arm_id,
  ref: r.ref,
  title: r.title,
  notes: r.notes,
  url: r.url,
  dueDate: r.due_date,
  status: r.status,
  createdAt: r.created_at
})

const MAX_TITLE = 200
const MAX_REF = 300
const MAX_NOTES = 5000
const MAX_URL = 2000

function validate(armId: string, input: CandidateInput): CandidateInput {
  const issues: ValidationIssue[] = []
  if (typeof armId !== 'string' || armId === '') issues.push({ field: 'armId', message: 'is required' })
  if (typeof input?.ref !== 'string' || input.ref.trim() === '' || input.ref.length > MAX_REF) issues.push({ field: 'ref', message: 'must be a non-empty string' })
  if (typeof input?.title !== 'string' || input.title.trim() === '') issues.push({ field: 'title', message: 'must be a non-empty string' })
  if (input?.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > MAX_NOTES)) issues.push({ field: 'notes', message: 'must be a string' })
  if (input?.url !== undefined && (typeof input.url !== 'string' || input.url.length > MAX_URL || parseShortcutUrl(input.url) === null)) {
    issues.push({ field: 'url', message: 'must be an http(s) address' })
  }
  if (input?.dueDate !== undefined && !isValidDateString(input.dueDate)) issues.push({ field: 'dueDate', message: 'must be YYYY-MM-DD' })
  if (issues.length > 0) throw new CandidateValidationError(issues)
  return input
}

export function createCandidateRepository(
  db: DatabaseSync,
  deps: { newId: () => string; now: () => Date; tasks: Pick<TaskRepository, 'create'> }
): CandidateRepository {
  const row = (id: string): Row | undefined => db.prepare('SELECT * FROM inbox_candidates WHERE id = ?').get(id) as Row | undefined

  function acceptRow(r: Row): Task {
    return withTransaction(db, () => {
      const changed = db.prepare("UPDATE inbox_candidates SET status = 'accepted' WHERE id = ? AND status = 'pending'").run(r.id).changes
      if (Number(changed) === 0) throw new CandidateNotFoundError(r.id)
      // 할 일 만들기가 실패하면(검증 등) 위의 상태 변경도 함께 되돌아간다.
      return deps.tasks.create({
        title: r.title.trim().slice(0, MAX_TITLE),
        notes: r.notes,
        deadline: r.due_date,
        source: { arm: r.arm_id, ref: r.ref, ...(r.url ? { url: r.url } : {}) }
      })
    })
  }

  const repo: CandidateRepository = {
    add(armId, raw, options = {}) {
      const input = validate(armId, raw)
      return withTransaction(db, () => {
        const id = deps.newId()
        const inserted = db
          .prepare(
            "INSERT OR IGNORE INTO inbox_candidates (id, arm_id, ref, title, notes, url, due_date, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')"
          )
          .run(id, armId, input.ref, input.title.trim().slice(0, MAX_TITLE), input.notes ?? '', input.url ?? null, input.dueDate ?? null, deps.now().toISOString())
        if (Number(inserted.changes) === 0) return { added: false, accepted: false }
        if (options.autoAccept) {
          acceptRow(row(id) as Row)
          return { added: true, accepted: true }
        }
        return { added: true, accepted: false }
      })
    },

    listPending() {
      return (db.prepare("SELECT * FROM inbox_candidates WHERE status = 'pending' ORDER BY created_at, id").all() as unknown as Row[]).map(toCandidate)
    },

    get(id) {
      const r = row(id)
      return r ? toCandidate(r) : undefined
    },

    accept(id) {
      const r = row(id)
      if (!r || r.status !== 'pending') throw new CandidateNotFoundError(id)
      return acceptRow(r)
    },

    dismiss(id) {
      const changed = db.prepare("UPDATE inbox_candidates SET status = 'dismissed' WHERE id = ? AND status = 'pending'").run(id).changes
      if (Number(changed) === 0) throw new CandidateNotFoundError(id)
    },

    acceptAll() {
      return withTransaction(db, () => {
        const pending = repo.listPending()
        for (const c of pending) repo.accept(c.id)
        return pending.length
      })
    },

    dismissAll() {
      return Number(db.prepare("UPDATE inbox_candidates SET status = 'dismissed' WHERE status = 'pending'").run().changes)
    }
  }
  return repo
}

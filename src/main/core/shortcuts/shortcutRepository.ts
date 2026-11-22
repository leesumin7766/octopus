import { basename, isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AddUrlInput, MoveDirection, PathType, Shortcut } from '../../../shared/shortcuts/types'
import { createUlidGenerator } from '../../../shared/tasks/ulid'
import {
  isPlausiblePath,
  parseShortcutLabel,
  parseShortcutUrl,
  ShortcutValidationError
} from '../../../shared/validation/shortcut'
import { withTransaction } from '../db/transaction'
import { EntityNotFoundError } from '../errors'

export class ShortcutNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('shortcut', id)
    this.name = 'ShortcutNotFoundError'
  }
}

export interface ShortcutRepositoryDeps {
  /** 현재 시각. 안에서 new Date() 를 직접 부르지 않도록 바깥에서 넣는다. */
  now: () => Date
}

export interface ShortcutRepository {
  list(): Shortcut[]
  get(id: string): Shortcut | undefined
  /** 링크(http·https). 이름을 비우면 주소의 호스트 이름. */
  createUrl(input: AddUrlInput): Shortcut
  /** 경로는 main 의 파일 선택 대화상자가 돌려준 값이어야 한다(렌더러가 보낸 문자열을 그대로 넣지 않는다). */
  createPath(input: { path: string; pathType: PathType; label?: string }): Shortcut
  rename(id: string, label: string): Shortcut
  remove(id: string): boolean
  /** 목록에서 위/아래 이웃과 자리를 바꾼다. 맨 끝이면 아무 일도 없다. */
  move(id: string, direction: MoveDirection): void
  /** 실행 파일 바로가기를 사용자가 허용했다고 기억한다. */
  setAllowed(id: string): Shortcut
}

const SELECT = `
  SELECT id, kind, path_type AS pathType, label, target, allowed, sort_order AS "order",
         created_at AS createdAt, updated_at AS updatedAt
  FROM shortcuts`

interface RawRow {
  id: string
  kind: 'url' | 'path'
  pathType: PathType | null
  label: string
  target: string
  allowed: number
  order: number
  createdAt: string
  updatedAt: string
}

function rowToShortcut(row: unknown): Shortcut {
  const raw = row as RawRow
  return { ...raw, allowed: raw.allowed === 1 }
}

function invalid(field: string, message: string): ShortcutValidationError {
  return new ShortcutValidationError([{ field, message }])
}

export function createShortcutRepository(db: DatabaseSync, deps: ShortcutRepositoryDeps): ShortcutRepository {
  const nextId = createUlidGenerator()

  function get(id: string): Shortcut | undefined {
    const row = db.prepare(`${SELECT} WHERE id = ?`).get(id)
    return row === undefined ? undefined : rowToShortcut(row)
  }

  function mustGet(id: string): Shortcut {
    const shortcut = get(id)
    if (!shortcut) throw new ShortcutNotFoundError(id)
    return shortcut
  }

  function list(): Shortcut[] {
    return db.prepare(`${SELECT} ORDER BY sort_order, created_at, id`).all().map(rowToShortcut)
  }

  function insert(kind: 'url' | 'path', pathType: PathType | null, label: string, target: string): Shortcut {
    const now = deps.now()
    const iso = now.toISOString()
    const id = nextId(now.getTime())
    db.prepare(
      `INSERT INTO shortcuts (id, kind, path_type, label, target, allowed, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM shortcuts), ?, ?)`
    ).run(id, kind, pathType, label, target, iso, iso)
    return mustGet(id)
  }

  return {
    list,
    get,

    createUrl(input) {
      const url = parseShortcutUrl(input.url)
      if (url === null) throw invalid('url', 'must be an http or https address')

      const wanted = input.label === undefined || input.label.trim() === '' ? new URL(url).hostname : input.label
      const label = parseShortcutLabel(wanted)
      if (label === null) throw invalid('label', 'must be 1-100 characters')
      return insert('url', null, label, url)
    },

    createPath(input) {
      if (!isPlausiblePath(input.path) || !isAbsolute(input.path)) throw invalid('path', 'must be an absolute path')
      if (input.pathType !== 'file' && input.pathType !== 'folder') throw invalid('pathType', 'must be file or folder')

      const name = input.label === undefined || input.label.trim() === '' ? basename(input.path) || input.path : input.label
      const label = parseShortcutLabel(name)
      if (label === null) throw invalid('label', 'must be 1-100 characters')
      return insert('path', input.pathType, label, input.path)
    },

    rename(id, label) {
      const parsed = parseShortcutLabel(label)
      if (parsed === null) throw invalid('label', 'must be 1-100 characters')
      mustGet(id)
      db.prepare('UPDATE shortcuts SET label = ?, updated_at = ? WHERE id = ?').run(parsed, deps.now().toISOString(), id)
      return mustGet(id)
    },

    remove(id) {
      return Number(db.prepare('DELETE FROM shortcuts WHERE id = ?').run(id).changes) === 1
    },

    move(id, direction) {
      withTransaction(db, () => {
        const all = list()
        const index = all.findIndex((shortcut) => shortcut.id === id)
        if (index < 0) throw new ShortcutNotFoundError(id)

        const other = all[direction === 'up' ? index - 1 : index + 1]
        if (!other) return
        const update = db.prepare('UPDATE shortcuts SET sort_order = ? WHERE id = ?')
        update.run(other.order, id)
        update.run(all[index].order, other.id)
      })
    },

    setAllowed(id) {
      mustGet(id)
      db.prepare('UPDATE shortcuts SET allowed = 1, updated_at = ? WHERE id = ?').run(deps.now().toISOString(), id)
      return mustGet(id)
    }
  }
}

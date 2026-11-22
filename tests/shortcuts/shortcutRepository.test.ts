import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import {
  createShortcutRepository,
  ShortcutNotFoundError,
  type ShortcutRepository
} from '../../src/main/core/shortcuts/shortcutRepository'
import { ShortcutValidationError } from '../../src/shared/validation/shortcut'

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const at = (day: number): Date => new Date(2026, 2, day, 12, 0, 0)

describe('shortcut repository', () => {
  let db: DatabaseSync
  let repo: ShortcutRepository
  let now: Date

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db, migrations)
    now = at(10)
    repo = createShortcutRepository(db, { now: () => now })
  })

  afterEach(() => {
    db.close()
  })

  const titles = (): string[] => repo.list().map((s) => s.label)

  describe('links', () => {
    it('stores the normalized address; the name defaults to the host name', () => {
      const shortcut = repo.createUrl({ url: '  HTTPS://Docs.Example.com/guide  ' })

      expect(shortcut).toMatchObject({
        kind: 'url',
        pathType: null,
        label: 'docs.example.com',
        target: 'https://docs.example.com/guide',
        allowed: false,
        order: 1
      })
      expect(shortcut.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(shortcut.createdAt).toBe(shortcut.updatedAt)
      expect(repo.get(shortcut.id)).toEqual(shortcut)
    })

    it('uses the given name, trimmed', () => {
      expect(repo.createUrl({ url: 'https://example.com', label: '  예시 사이트 ' }).label).toBe('예시 사이트')
      expect(repo.createUrl({ url: 'https://example.com', label: '   ' }).label).toBe('example.com')
    })

    it('refuses addresses that are not http(s), storing nothing', () => {
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'example.com', 'https://u:p@example.com', '']) {
        expect(() => repo.createUrl({ url })).toThrow(ShortcutValidationError)
      }
      expect(repo.list()).toEqual([])
    })

    it('reports which field is wrong', () => {
      try {
        repo.createUrl({ url: 'file:///x' })
        expect.unreachable()
      } catch (error) {
        expect((error as ShortcutValidationError).issues.map((i) => i.field)).toEqual(['url'])
      }
      try {
        repo.createUrl({ url: 'https://example.com', label: 'x'.repeat(101) })
        expect.unreachable()
      } catch (error) {
        expect((error as ShortcutValidationError).issues.map((i) => i.field)).toEqual(['label'])
      }
    })
  })

  describe('files and folders', () => {
    const file = join(tmpdir(), 'docs', 'report.pdf')
    const folder = join(tmpdir(), 'projects')

    it('keeps the path and the kind of path; the name defaults to the last part of the path', () => {
      const f = repo.createPath({ path: file, pathType: 'file' })
      const d = repo.createPath({ path: folder, pathType: 'folder', label: '프로젝트 폴더' })

      expect(f).toMatchObject({ kind: 'path', pathType: 'file', label: 'report.pdf', target: file, allowed: false })
      expect(d).toMatchObject({ kind: 'path', pathType: 'folder', label: '프로젝트 폴더', target: folder })
    })

    it('needs an absolute path and a known kind', () => {
      expect(() => repo.createPath({ path: 'relative/file.txt', pathType: 'file' })).toThrow(ShortcutValidationError)
      expect(() => repo.createPath({ path: '', pathType: 'file' })).toThrow(ShortcutValidationError)
      expect(() => repo.createPath({ path: file, pathType: 'socket' as never })).toThrow(ShortcutValidationError)
      expect(repo.list()).toEqual([])
    })
  })

  describe('rename / remove', () => {
    it('renames, trims and refreshes updatedAt', () => {
      const shortcut = repo.createUrl({ url: 'https://example.com' })
      now = at(11)

      const renamed = repo.rename(shortcut.id, '  새 이름 ')

      expect(renamed).toMatchObject({ label: '새 이름', target: shortcut.target, createdAt: shortcut.createdAt })
      expect(renamed.updatedAt).toBe(at(11).toISOString())
    })

    it('refuses an empty or too long name and an unknown id', () => {
      const shortcut = repo.createUrl({ url: 'https://example.com' })

      expect(() => repo.rename(shortcut.id, '  ')).toThrow(ShortcutValidationError)
      expect(() => repo.rename(shortcut.id, 'x'.repeat(101))).toThrow(ShortcutValidationError)
      expect(() => repo.rename(MISSING, '이름')).toThrow(ShortcutNotFoundError)
      expect(repo.get(shortcut.id)).toEqual(shortcut)
    })

    it('removes and reports whether something was removed', () => {
      const shortcut = repo.createUrl({ url: 'https://example.com' })

      expect(repo.remove(shortcut.id)).toBe(true)
      expect(repo.remove(shortcut.id)).toBe(false)
      expect(repo.get(shortcut.id)).toBeUndefined()
    })
  })

  describe('order', () => {
    function three() {
      const a = repo.createUrl({ url: 'https://a.example', label: 'A' })
      const b = repo.createUrl({ url: 'https://b.example', label: 'B' })
      const c = repo.createUrl({ url: 'https://c.example', label: 'C' })
      return { a, b, c }
    }

    it('lists in the order they were added', () => {
      three()

      expect(titles()).toEqual(['A', 'B', 'C'])
    })

    it('move up and down swap with the neighbor', () => {
      const { b, c } = three()

      repo.move(c.id, 'up')
      expect(titles()).toEqual(['A', 'C', 'B'])
      repo.move(b.id, 'up')
      expect(titles()).toEqual(['A', 'B', 'C'])
      repo.move(repo.list()[0].id, 'down')
      expect(titles()).toEqual(['B', 'A', 'C'])
    })

    it('does nothing at the ends', () => {
      const { a, c } = three()

      repo.move(a.id, 'up')
      repo.move(c.id, 'down')

      expect(titles()).toEqual(['A', 'B', 'C'])
    })

    it('throws for an unknown id', () => {
      three()

      expect(() => repo.move(MISSING, 'up')).toThrow(ShortcutNotFoundError)
    })

    it('a new shortcut goes to the end even after a removal', () => {
      const { a } = three()
      repo.remove(a.id)

      repo.createUrl({ url: 'https://d.example', label: 'D' })

      expect(titles()).toEqual(['B', 'C', 'D'])
    })
  })

  describe('setAllowed', () => {
    it('remembers the permission for that shortcut only', () => {
      const a = repo.createPath({ path: join(tmpdir(), 'tool.exe'), pathType: 'file' })
      const b = repo.createPath({ path: join(tmpdir(), 'other.exe'), pathType: 'file' })

      expect(repo.setAllowed(a.id).allowed).toBe(true)

      expect(repo.get(a.id)?.allowed).toBe(true)
      expect(repo.get(b.id)?.allowed).toBe(false)
    })

    it('throws for an unknown id', () => {
      expect(() => repo.setAllowed(MISSING)).toThrow(ShortcutNotFoundError)
    })
  })
})

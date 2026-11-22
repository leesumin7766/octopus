import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { createShortcutRepository, type ShortcutRepository } from '../../src/main/core/shortcuts/shortcutRepository'
import type { IpcMainLike } from '../../src/main/ipc/result'
import { createShortcutHandlers, registerShortcutHandlers, type ShortcutHandlers } from '../../src/main/ipc/shortcuts'
import type { ShortcutPlatform } from '../../src/main/platform/shortcutPlatform'
import { IPC, type IpcResult } from '../../src/shared/ipc'

const MISSING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

type FakePlatform = { [K in keyof ShortcutPlatform]: Mock<ShortcutPlatform[K]> }

interface Setup {
  db: DatabaseSync
  repo: ShortcutRepository
  handlers: ShortcutHandlers
  platform: FakePlatform
  logged: { channel: string; error: unknown }[]
}

function setup(repository?: (repo: ShortcutRepository) => ShortcutRepository | null): Setup {
  const db = new DatabaseSync(':memory:')
  runMigrations(db, migrations)
  const repo = createShortcutRepository(db, { now: () => new Date(2026, 2, 10, 12) })
  const platform: FakePlatform = {
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    pathExists: vi.fn(() => true),
    pickPath: vi.fn(async () => null),
    confirmRunExecutable: vi.fn(async () => true)
  }
  const logged: Setup['logged'] = []
  const handlers = createShortcutHandlers({
    getRepository: () => (repository ? repository(repo) : repo),
    platform,
    logError: (channel, error) => logged.push({ channel, error })
  })
  return { db, repo, handlers, platform, logged }
}

function data<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`expected ok but got ${JSON.stringify(result.error)}`)
  return result.data
}

const nothingOpened = (platform: FakePlatform): void => {
  expect(platform.openExternal).not.toHaveBeenCalled()
  expect(platform.openPath).not.toHaveBeenCalled()
}

describe('shortcut IPC handlers', () => {
  let current: Setup | undefined
  let s: Setup

  beforeEach(() => {
    s = current = setup()
  })

  afterEach(() => {
    try {
      current?.db.close()
    } catch {
      // 테스트가 이미 닫은 DB
    }
    current = undefined
  })

  const invalid = (result: unknown, ...fields: string[]) =>
    expect(result).toEqual({ ok: false, error: { code: 'invalid_input', fields } })

  const file = (name: string) => join(tmpdir(), name)

  describe('adding a link', () => {
    it('saves an http(s) link and lists it', () => {
      const added = data(s.handlers.addUrl({ url: 'https://example.com/docs', label: ' 문서 ' }))

      expect(added).toMatchObject({ kind: 'url', label: '문서', target: 'https://example.com/docs' })
      expect(data(s.handlers.list()).map((x) => x.id)).toEqual([added.id])
    })

    it('refuses javascript:, file: and other schemes, saving nothing', () => {
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'ftp://example.com', 'example.com', 'https://user:pw@example.com']) {
        invalid(s.handlers.addUrl({ url }), 'url')
      }
      expect(data(s.handlers.list())).toEqual([])
    })

    it('refuses anything that is not a { url, label? } object — in particular a path', () => {
      invalid(s.handlers.addUrl({ url: 'https://example.com', path: '/etc/passwd' }), 'input')
      invalid(s.handlers.addUrl({ path: '/etc/passwd' }), 'input')
      invalid(s.handlers.addUrl({ url: 'https://example.com', kind: 'path', target: '/bin/sh' }), 'input')
      invalid(s.handlers.addUrl(null), 'input')
      invalid(s.handlers.addUrl('https://example.com'), 'input')
      invalid(s.handlers.addUrl({ url: 5 }), 'url')
      invalid(s.handlers.addUrl({ url: 'https://example.com', label: 5 }), 'label')
      expect(data(s.handlers.list())).toEqual([])
    })

    it('reports a too long label as a label problem', () => {
      invalid(s.handlers.addUrl({ url: 'https://example.com', label: 'x'.repeat(101) }), 'label')
    })
  })

  describe('picking a file or folder', () => {
    it('opens the dialog in main and saves what was picked, named after it', async () => {
      s.platform.pickPath.mockResolvedValueOnce(file('report.pdf'))

      const picked = data(await s.handlers.pickPath('file'))

      expect(s.platform.pickPath).toHaveBeenCalledWith('file')
      expect(picked).toMatchObject({ kind: 'path', pathType: 'file', label: 'report.pdf', target: file('report.pdf') })
      expect(s.repo.list()).toHaveLength(1)
    })

    it('a folder is saved as a folder', async () => {
      s.platform.pickPath.mockResolvedValueOnce(file('projects'))

      expect(data(await s.handlers.pickPath('folder'))).toMatchObject({ pathType: 'folder' })
      expect(s.platform.pickPath).toHaveBeenCalledWith('folder')
    })

    it('saves nothing when the dialog is cancelled (and it is not an error)', async () => {
      s.platform.pickPath.mockResolvedValueOnce(null)

      const result = await s.handlers.pickPath('file')

      expect(result).toEqual({ ok: true, data: null })
      expect(s.repo.list()).toEqual([])
    })

    it('refuses an unknown kind without opening a dialog', async () => {
      for (const kind of ['url', 'path', '', '/etc/passwd', null, undefined, 5]) {
        invalid(await s.handlers.pickPath(kind), 'kind')
      }
      expect(s.platform.pickPath).not.toHaveBeenCalled()
    })

    it('a dialog failure is internal and logged', async () => {
      const boom = new Error('SECRET dialog failure')
      s.platform.pickPath.mockRejectedValueOnce(boom)

      const result = await s.handlers.pickPath('file')

      expect(result).toEqual({ ok: false, error: { code: 'internal' } })
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(s.logged).toEqual([{ channel: IPC.shortcutsPickPath, error: boom }])
    })

    it('a relative path from the dialog is refused rather than saved', async () => {
      s.platform.pickPath.mockResolvedValueOnce('relative/file.txt')

      invalid(await s.handlers.pickPath('file'), 'path')
      expect(s.repo.list()).toEqual([])
    })
  })

  describe('opening', () => {
    it('a link opens in the browser, using the stored address', async () => {
      const link = s.repo.createUrl({ url: 'https://example.com/a?b=1' })

      expect(await s.handlers.open(link.id)).toEqual({ ok: true, data: { opened: true } })

      expect(s.platform.openExternal).toHaveBeenCalledTimes(1)
      expect(s.platform.openExternal).toHaveBeenCalledWith('https://example.com/a?b=1')
      expect(s.platform.openPath).not.toHaveBeenCalled()
    })

    it('a file opens with its stored path', async () => {
      const pdf = s.repo.createPath({ path: file('report.pdf'), pathType: 'file' })

      expect(await s.handlers.open(pdf.id)).toEqual({ ok: true, data: { opened: true } })

      expect(s.platform.openPath).toHaveBeenCalledWith(file('report.pdf'))
      expect(s.platform.confirmRunExecutable).not.toHaveBeenCalled()
    })

    it('only the id decides what is opened: extra arguments are ignored, and only a stored id works', async () => {
      const link = s.repo.createUrl({ url: 'https://example.com' })
      const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
      registerShortcutHandlers({ handle: (channel, listener) => void registered.set(channel, listener) }, s.handlers)

      await registered.get(IPC.shortcutsOpen)?.({}, link.id, 'file:///etc/passwd', 'C:/Windows/System32/cmd.exe')

      expect(s.platform.openExternal).toHaveBeenCalledWith('https://example.com/')
      expect(s.platform.openPath).not.toHaveBeenCalled()

      // 주소나 경로를 id 자리에 보내도 열리지 않는다.
      for (const notAnId of ['https://example.com', 'file:///etc/passwd', 'C:/Windows/System32/cmd.exe', '/bin/sh', 'calc']) {
        invalid(await s.handlers.open(notAnId), 'id')
      }
      expect(s.platform.openExternal).toHaveBeenCalledTimes(1)
    })

    it('an unknown id is not_found and opens nothing', async () => {
      expect(await s.handlers.open(MISSING_ID)).toEqual({ ok: false, error: { code: 'not_found' } })
      nothingOpened(s.platform)
    })

    it('a bad id is invalid_input', async () => {
      invalid(await s.handlers.open(undefined), 'id')
      invalid(await s.handlers.open(5), 'id')
      invalid(await s.handlers.open({ id: MISSING_ID }), 'id')
    })

    it('refuses to open a stored address that is not http(s), even if it got into the database some other way', async () => {
      s.db
        .prepare(`INSERT INTO shortcuts (id, kind, path_type, label, target, sort_order, created_at, updated_at)
                  VALUES ('01BAD', 'url', NULL, 'bad', 'javascript:alert(1)', 1, 'x', 'x')`)
        .run()
      s.db
        .prepare(`INSERT INTO shortcuts (id, kind, path_type, label, target, sort_order, created_at, updated_at)
                  VALUES ('01FILE', 'url', NULL, 'bad', 'file:///etc/passwd', 2, 'x', 'x')`)
        .run()
      // 위 id 는 ULID 모양이 아니라 id 검사에서 먼저 막힌다. 모양을 맞춘 id 로 다시 넣는다.
      s.db.prepare("UPDATE shortcuts SET id = '01ARZ3NDEKTSV4RRFFQ69G5FAA' WHERE id = '01BAD'").run()
      s.db.prepare("UPDATE shortcuts SET id = '01ARZ3NDEKTSV4RRFFQ69G5FAB' WHERE id = '01FILE'").run()

      for (const id of ['01ARZ3NDEKTSV4RRFFQ69G5FAA', '01ARZ3NDEKTSV4RRFFQ69G5FAB']) {
        const result = await s.handlers.open(id)
        expect(result).toEqual({ ok: false, error: { code: 'internal' } })
      }
      nothingOpened(s.platform)
      expect(s.logged).toHaveLength(2)
    })

    it('a missing file or folder gives not_found_path and opens nothing', async () => {
      const gone = s.repo.createPath({ path: file('gone.pdf'), pathType: 'file' })
      s.platform.pathExists.mockReturnValue(false)

      expect(await s.handlers.open(gone.id)).toEqual({ ok: false, error: { code: 'not_found_path' } })

      expect(s.platform.pathExists).toHaveBeenCalledWith(file('gone.pdf'))
      nothingOpened(s.platform)
      expect(s.platform.confirmRunExecutable).not.toHaveBeenCalled()
      expect(s.logged).toEqual([]) // 사용자가 다음에 할 일이 분명한 상황이라 오류 로그를 남기지 않는다
    })

    it('a failure to open is internal, logged, and does not leak the system message', async () => {
      const pdf = s.repo.createPath({ path: file('report.pdf'), pathType: 'file' })
      s.platform.openPath.mockResolvedValueOnce('SECRET system message')

      const result = await s.handlers.open(pdf.id)

      expect(result).toEqual({ ok: false, error: { code: 'internal' } })
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(s.logged).toHaveLength(1)
    })

    it('a failure to open a link is internal too', async () => {
      const link = s.repo.createUrl({ url: 'https://example.com' })
      s.platform.openExternal.mockRejectedValueOnce(new Error('boom'))

      expect(await s.handlers.open(link.id)).toEqual({ ok: false, error: { code: 'internal' } })
    })
  })

  describe('programs and scripts', () => {
    const program = () => s.repo.createPath({ path: file('setup.exe'), pathType: 'file' })

    it('asks first, and does not open when the user says no (nor remember anything)', async () => {
      const shortcut = program()
      s.platform.confirmRunExecutable.mockResolvedValueOnce(false)

      const result = await s.handlers.open(shortcut.id)

      expect(result).toEqual({ ok: true, data: { opened: false } })
      expect(s.platform.confirmRunExecutable).toHaveBeenCalledWith({ label: 'setup.exe', path: file('setup.exe') })
      nothingOpened(s.platform)
      expect(s.repo.get(shortcut.id)?.allowed).toBe(false)
    })

    it('opens when the user says yes, and remembers it for that shortcut', async () => {
      const shortcut = program()

      expect(await s.handlers.open(shortcut.id)).toEqual({ ok: true, data: { opened: true } })

      expect(s.platform.openPath).toHaveBeenCalledWith(file('setup.exe'))
      expect(s.repo.get(shortcut.id)?.allowed).toBe(true)
    })

    it('does not ask again once it was allowed', async () => {
      const shortcut = program()
      await s.handlers.open(shortcut.id)
      s.platform.confirmRunExecutable.mockClear()

      await s.handlers.open(shortcut.id)

      expect(s.platform.confirmRunExecutable).not.toHaveBeenCalled()
      expect(s.platform.openPath).toHaveBeenCalledTimes(2)
    })

    it('asks again after a "no", and the permission of one shortcut does not carry over to another', async () => {
      const first = program()
      const second = s.repo.createPath({ path: file('other.bat'), pathType: 'file' })
      s.platform.confirmRunExecutable.mockResolvedValueOnce(false)
      await s.handlers.open(first.id)

      await s.handlers.open(first.id) // 두 번째는 허용(기본 가짜는 true)
      s.platform.confirmRunExecutable.mockClear()
      await s.handlers.open(second.id)

      expect(s.platform.confirmRunExecutable).toHaveBeenCalledTimes(1)
      expect(s.platform.confirmRunExecutable).toHaveBeenCalledWith({ label: 'other.bat', path: file('other.bat') })
    })

    it('every executable kind is asked about, not only .exe', async () => {
      for (const name of ['a.bat', 'b.cmd', 'c.lnk', 'd.ps1', 'E.EXE', 'f.sh', 'g.app']) {
        const shortcut = s.repo.createPath({ path: file(name), pathType: 'file' })
        s.platform.confirmRunExecutable.mockClear()
        s.platform.confirmRunExecutable.mockResolvedValueOnce(false)

        await s.handlers.open(shortcut.id)

        expect(s.platform.confirmRunExecutable, name).toHaveBeenCalledTimes(1)
      }
      nothingOpened(s.platform)
    })

    it('ordinary documents and folders are opened without any question', async () => {
      const doc = s.repo.createPath({ path: file('notes.txt'), pathType: 'file' })
      const folder = s.repo.createPath({ path: file('projects'), pathType: 'folder' })

      await s.handlers.open(doc.id)
      await s.handlers.open(folder.id)

      expect(s.platform.confirmRunExecutable).not.toHaveBeenCalled()
      expect(s.platform.openPath).toHaveBeenCalledTimes(2)
    })

    it('a missing program is reported as missing before any question', async () => {
      const shortcut = program()
      s.platform.pathExists.mockReturnValue(false)

      expect(await s.handlers.open(shortcut.id)).toEqual({ ok: false, error: { code: 'not_found_path' } })
      expect(s.platform.confirmRunExecutable).not.toHaveBeenCalled()
    })

    it('a failing confirmation window is internal and opens nothing', async () => {
      const shortcut = program()
      s.platform.confirmRunExecutable.mockRejectedValueOnce(new Error('boom'))

      expect(await s.handlers.open(shortcut.id)).toEqual({ ok: false, error: { code: 'internal' } })
      nothingOpened(s.platform)
    })
  })

  describe('rename, remove and move', () => {
    it('rename', () => {
      const link = s.repo.createUrl({ url: 'https://example.com' })

      expect(data(s.handlers.rename(link.id, '  새 이름 '))).toMatchObject({ label: '새 이름' })
      invalid(s.handlers.rename(link.id, '  '), 'label')
      invalid(s.handlers.rename(link.id, 5), 'label')
      invalid(s.handlers.rename('nope', '이름'), 'id')
      expect(s.handlers.rename(MISSING_ID, '이름')).toEqual({ ok: false, error: { code: 'not_found' } })
    })

    it('remove', () => {
      const link = s.repo.createUrl({ url: 'https://example.com' })

      expect(data(s.handlers.remove(link.id))).toBeNull()
      expect(s.repo.get(link.id)).toBeUndefined()
      expect(s.handlers.remove(link.id)).toEqual({ ok: false, error: { code: 'not_found' } })
      invalid(s.handlers.remove('x'), 'id')
    })

    it('move', () => {
      const a = s.repo.createUrl({ url: 'https://a.example', label: 'A' })
      const b = s.repo.createUrl({ url: 'https://b.example', label: 'B' })

      expect(data(s.handlers.move(b.id, 'up'))).toBeNull()
      expect(s.repo.list().map((x) => x.id)).toEqual([b.id, a.id])
      invalid(s.handlers.move(a.id, 'left'), 'direction')
      invalid(s.handlers.move('x', 'up'), 'id')
      expect(s.handlers.move(MISSING_ID, 'up')).toEqual({ ok: false, error: { code: 'not_found' } })
    })
  })

  describe('failures', () => {
    it('db_unavailable when there is no repository', async () => {
      const { handlers, platform } = (current = setup(() => null))
      const unavailable = { ok: false, error: { code: 'db_unavailable' } }

      expect(handlers.list()).toEqual(unavailable)
      expect(handlers.addUrl({ url: 'https://example.com' })).toEqual(unavailable)
      expect(await handlers.pickPath('file')).toEqual(unavailable)
      expect(await handlers.open(MISSING_ID)).toEqual(unavailable)
      expect(handlers.rename(MISSING_ID, '이름')).toEqual(unavailable)
      expect(handlers.remove(MISSING_ID)).toEqual(unavailable)
      expect(handlers.move(MISSING_ID, 'up')).toEqual(unavailable)
      nothingOpened(platform)
      expect(platform.pickPath).not.toHaveBeenCalled() // DB 가 없으면 대화상자도 열지 않는다
    })

    it('internal errors hide the original message and are logged', () => {
      const boom = new Error('SECRET db path')
      const { handlers, logged } = (current = setup(() => ({ list: () => { throw boom } }) as unknown as ShortcutRepository))

      const result = handlers.list()

      expect(result).toEqual({ ok: false, error: { code: 'internal' } })
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(logged).toEqual([{ channel: IPC.shortcutsList, error: boom }])
    })

    it('never puts the user input in the response', () => {
      const secret = 'SECRET-SHORTCUT-TEXT'

      const results = [
        s.handlers.addUrl({ url: `javascript:${secret}` }),
        s.handlers.addUrl({ [secret]: 1 }),
        s.handlers.rename(secret, secret),
        s.handlers.move(secret, secret)
      ]

      for (const result of results) {
        expect(result.ok).toBe(false)
        expect(JSON.stringify(result)).not.toContain(secret)
      }
    })
  })

  it('registerShortcutHandlers wires every shortcuts channel and passes only the expected arguments', async () => {
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }

    registerShortcutHandlers(ipc, s.handlers)

    const channels = Object.values(IPC).filter((channel) => channel.startsWith('shortcuts:'))
    expect([...registered.keys()].sort()).toEqual([...channels].sort())

    const call = (channel: string, ...args: unknown[]): unknown => registered.get(channel)?.({ sender: 'x' }, ...args)
    const added = data((await call(IPC.shortcutsAddUrl, { url: 'https://example.com' })) as IpcResult<{ id: string }>)
    expect(await call(IPC.shortcutsRename, added.id, '이름')).toMatchObject({ ok: true, data: { label: '이름' } })
    expect(await call(IPC.shortcutsList)).toMatchObject({ ok: true, data: [{ id: added.id }] })
    expect(await call(IPC.shortcutsMove, added.id, 'down')).toEqual({ ok: true, data: null })

    // 파일 선택은 종류만 받고, 같이 보낸 경로는 어디에도 쓰이지 않는다.
    s.platform.pickPath.mockResolvedValueOnce(join(tmpdir(), 'picked.txt'))
    const picked = await call(IPC.shortcutsPickPath, 'file', '/etc/passwd')
    expect(s.platform.pickPath).toHaveBeenCalledWith('file')
    expect(picked).toMatchObject({ ok: true, data: { target: join(tmpdir(), 'picked.txt') } })

    expect(await call(IPC.shortcutsOpen, added.id)).toEqual({ ok: true, data: { opened: true } })
    expect(await call(IPC.shortcutsRemove, added.id)).toEqual({ ok: true, data: null })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createUpdateHandlers, registerUpdateHandlers } from '../src/main/ipc/update'
import { createUpdateChecker, errorKind, notesText, STARTUP_CHECK_DELAY_MS, type AutoUpdaterLike } from '../src/main/platform/updater'
import { IPC } from '../src/shared/ipc'
import type { UpdateState } from '../src/shared/update/types'
import { parseUpdateState } from '../src/shared/validation/update'

function fakeUpdater(opts: { check?: () => Promise<unknown>; download?: () => Promise<unknown> } = {}) {
  const handlers: Record<string, (arg?: never) => void> = {}
  const updater: AutoUpdaterLike & { checks: number; downloads: number; installs: unknown[][] } = {
    logger: console,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checks: 0,
    downloads: 0,
    installs: [],
    on: ((event: string, listener: (arg?: never) => void) => void (handlers[event] = listener)) as AutoUpdaterLike['on'],
    async checkForUpdates() {
      updater.checks++
      return (opts.check ?? (async () => undefined))()
    },
    async downloadUpdate() {
      updater.downloads++
      return (opts.download ?? (async () => undefined))()
    },
    quitAndInstall(...args: unknown[]) {
      updater.installs.push(args)
    }
  }
  return { updater, emit: (event: string, arg?: unknown) => handlers[event]?.(arg as never) }
}

const make = (opts: { isPackaged: boolean; updater?: ReturnType<typeof fakeUpdater> }) => {
  const f = opts.updater ?? fakeUpdater()
  const logs: string[] = []
  const changes: UpdateState[] = []
  const timers: { run: () => void; ms: number }[] = []
  const factory = vi.fn(() => f.updater)
  const checker = createUpdateChecker({
    isPackaged: opts.isPackaged,
    currentVersion: '0.1.0',
    autoUpdater: factory,
    log: (m) => void logs.push(m),
    onChange: (s) => void changes.push(s),
    setTimer: (run, ms) => void timers.push({ run, ms })
  })
  return { checker, f, logs, changes, timers, factory }
}

describe('update checker', () => {
  it('in development (not packaged) it is "disabled": no timer, the updater is never touched, nothing installs', async () => {
    const { checker, f, factory, timers } = make({ isPackaged: false })
    checker.start()
    expect(timers).toHaveLength(0)
    expect(await checker.check()).toEqual({ status: 'disabled', current: '0.1.0' })
    expect(await checker.download()).toEqual({ status: 'disabled', current: '0.1.0' })
    expect(factory).not.toHaveBeenCalled()
    expect(checker.install()).toBe(false)
    expect(f.updater.installs).toHaveLength(0)
  })

  it('a packaged app schedules ONE automatic check a few seconds after start (a second start does nothing)', async () => {
    const { checker, f, timers } = make({ isPackaged: true })
    expect(checker.state()).toEqual({ status: 'idle', current: '0.1.0' })
    checker.start()
    checker.start()
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(STARTUP_CHECK_DELAY_MS)
    expect(f.updater.checks).toBe(0) // 창이 먼저 뜬다
    timers[0].run()
    await vi.waitFor(() => expect(f.updater.checks).toBe(1))
    expect(checker.state().auto).toBe(true)
  })

  it('never downloads or installs by itself', async () => {
    const { checker, f } = make({ isPackaged: true })
    await checker.check()
    expect(f.updater.autoDownload).toBe(false) // 받기는 사용자가 누를 때만
    expect(f.updater.autoInstallOnAppQuit).toBe(false) // 앱을 끌 때 몰래 설치하지 않는다
    f.emit('update-available', { version: '0.2.0' })
    expect(f.updater.downloads).toBe(0)
    expect(f.updater.installs).toHaveLength(0)
  })

  it('checking → available (with plain-text notes) → [받기] → progress → ready → [설치]', async () => {
    const { checker, f, changes } = make({ isPackaged: true })
    await checker.check()
    expect(changes[0]).toEqual({ status: 'checking', current: '0.1.0' })

    f.emit('update-available', { version: '0.2.0', releaseNotes: '<p>새 <b>기능</b></p><ul><li>하나 &amp; 둘</li></ul>' })
    expect(checker.state()).toEqual({ status: 'available', current: '0.1.0', version: '0.2.0', notes: '새 기능\n하나 & 둘' })
    expect(checker.install()).toBe(false)

    const downloading = checker.download()
    expect(checker.state()).toMatchObject({ status: 'downloading', percent: 0 })
    f.emit('download-progress', { percent: 42.4 })
    expect(checker.state()).toMatchObject({ status: 'downloading', version: '0.2.0', percent: 42 })
    f.emit('update-downloaded', { version: '0.2.0' })
    await downloading
    expect(f.updater.downloads).toBe(1)
    expect(checker.state()).toEqual({ status: 'ready', current: '0.1.0', version: '0.2.0', notes: '새 기능\n하나 & 둘' })
    expect(f.updater.installs).toHaveLength(0) // 받았다고 설치하지 않는다

    expect(checker.install()).toBe(true)
    expect(f.updater.installs).toEqual([[true, true]])
  })

  it('no new version → "latest"; download is refused unless a version is available', async () => {
    const { checker, f } = make({ isPackaged: true })
    await checker.check()
    f.emit('update-not-available')
    expect(checker.state()).toEqual({ status: 'latest', current: '0.1.0' })
    await checker.download()
    expect(f.updater.downloads).toBe(0)
  })

  it('does not start another check while downloading or after the download', async () => {
    const { checker, f } = make({ isPackaged: true })
    await checker.check()
    f.emit('update-available', { version: '0.2.0' })
    f.emit('update-downloaded', { version: '0.2.0' })
    await checker.check()
    expect(f.updater.checks).toBe(1)
    expect(checker.state().status).toBe('ready')
  })

  it('a failed check (offline) becomes an "error" state with a kind, one log line, and never throws', async () => {
    const failing = fakeUpdater({
      check: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      }
    })
    const { checker, f, logs } = make({ isPackaged: true, updater: failing })
    await expect(checker.check()).resolves.toMatchObject({ status: 'error', error: 'offline' })
    f.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')) // 같은 실패가 이벤트로도 온다
    expect(logs).toEqual(['update failed: net::ERR_INTERNET_DISCONNECTED'])
    // 다시 확인할 수 있다
    await checker.check()
    expect(f.updater.checks).toBe(2)
  })

  it('a failed download is an error too, and a new check is allowed afterwards', async () => {
    const failing = fakeUpdater({
      download: async () => {
        throw new Error('sha512 checksum mismatch')
      }
    })
    const { checker, f } = make({ isPackaged: true, updater: failing })
    await checker.check()
    f.emit('update-available', { version: '0.2.0' })
    await expect(checker.download()).resolves.toMatchObject({ status: 'error', error: 'other' })
    await checker.check()
    expect(f.updater.checks).toBe(2)
  })

  it('a failure while creating the updater is quiet too', async () => {
    const logs: string[] = []
    const checker = createUpdateChecker({
      isPackaged: true,
      currentVersion: '0.1.0',
      autoUpdater: () => {
        throw new Error('electron-updater could not load')
      },
      log: (m) => void logs.push(m)
    })
    await expect(checker.check()).resolves.toMatchObject({ status: 'error' })
    expect(logs).toHaveLength(1)
  })
})

describe('update failure logging and wording', () => {
  const stack = ['Error: Error: No published versions on GitHub', '    at newError (C:\\app\\resources\\app.asar\\node_modules\\builder-util-runtime\\out\\error.js:5:19)', '    at XElement.element (xml.js:36:40)'].join('\n')

  it('replaces the library logger with a silent one (it printed whole stacks)', async () => {
    const { checker, f } = make({ isPackaged: true })
    await checker.check()
    expect(f.updater.logger).not.toBe(console)
    for (const level of ['info', 'warn', 'error'] as const) expect(() => f.updater.logger?.[level]?.(stack)).not.toThrow()
  })

  it('a multi-line stack becomes ONE line without the stack, and is classified as "no release"', async () => {
    const failing = fakeUpdater({
      check: async () => {
        throw new Error(stack)
      }
    })
    const { checker, logs } = make({ isPackaged: true, updater: failing })
    expect((await checker.check()).error).toBe('noRelease')
    expect(logs).toEqual(['update failed: No published versions on GitHub'])
  })

  it('very long messages are cut', async () => {
    const failing = fakeUpdater({
      check: async () => {
        throw new Error('x'.repeat(1000))
      }
    })
    const { checker, logs } = make({ isPackaged: true, updater: failing })
    await checker.check()
    expect(logs[0].length).toBeLessThan(260)
  })

  it('classifies errors', () => {
    expect(errorKind(new Error('getaddrinfo ENOTFOUND github.com'))).toBe('offline')
    expect(errorKind(new Error('HttpError: 404 Cannot find latest.yml'))).toBe('noRelease')
    expect(errorKind('weird')).toBe('other')
  })

  it('release notes: HTML becomes text, arrays are joined, empty is undefined', () => {
    expect(notesText([{ note: '<p>a</p>' }, { note: 'b' }])).toBe('a\n\nb')
    expect(notesText('<br>')).toBeUndefined()
    expect(notesText(null)).toBeUndefined()
    expect(notesText('x'.repeat(5000))?.length).toBe(2000)
  })
})

describe('update IPC', () => {
  it('state/check/download pass through; install only acts when ready; without a checker everything is a harmless no-op', async () => {
    const { checker, f } = make({ isPackaged: true })
    const handlers = createUpdateHandlers({ getChecker: () => checker })
    expect(handlers.state()).toEqual({ ok: true, data: { status: 'idle', current: '0.1.0' } })
    expect(await handlers.check()).toEqual({ ok: true, data: { status: 'checking', current: '0.1.0' } })
    expect(handlers.install()).toEqual({ ok: true, data: null })
    expect(f.updater.installs).toHaveLength(0)

    const none = createUpdateHandlers({ getChecker: () => null })
    expect(none.state().ok).toBe(true)
    expect((await none.check()).ok).toBe(true)
    expect((await none.download()).ok).toBe(true)
    expect(none.install()).toEqual({ ok: true, data: null })
  })

  it('registers exactly four channels', () => {
    const handle = vi.fn()
    registerUpdateHandlers({ handle }, createUpdateHandlers({ getChecker: () => null }))
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual([IPC.updateCheck, IPC.updateDownload, IPC.updateInstall, IPC.updateState].sort())
  })
})

describe('pushed update state validation', () => {
  it('keeps known fields of a well-formed state', () => {
    expect(parseUpdateState({ status: 'downloading', current: '0.1.0', version: '0.2.0', percent: 140.2, auto: true, extra: 'x' })).toEqual({
      status: 'downloading',
      current: '0.1.0',
      version: '0.2.0',
      percent: 100,
      auto: true
    })
    expect(parseUpdateState({ status: 'error', current: '0.1.0', error: 'offline' })).toEqual({ status: 'error', current: '0.1.0', error: 'offline' })
  })

  it('drops anything that does not look like a state', () => {
    for (const bad of [null, 'ready', {}, { status: 'hacked', current: '1' }, { status: 'ready' }, { status: 'ready', current: 'x'.repeat(100) }]) {
      expect(parseUpdateState(bad)).toBeNull()
    }
    expect(parseUpdateState({ status: 'error', current: '0.1.0', error: 'boom', notes: 3 })).toEqual({ status: 'error', current: '0.1.0' })
  })
})

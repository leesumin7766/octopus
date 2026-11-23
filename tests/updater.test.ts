import { describe, expect, it, vi } from 'vitest'
import { createUpdateHandlers, registerUpdateHandlers } from '../src/main/ipc/update'
import { createUpdateChecker, type AutoUpdaterLike } from '../src/main/platform/updater'
import { IPC } from '../src/shared/ipc'

function fakeUpdater(check: () => Promise<unknown> = async () => undefined) {
  const handlers: Record<string, (arg: never) => void> = {}
  const updater: AutoUpdaterLike & { checks: number; installs: number } = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checks: 0,
    installs: 0,
    on: ((event: string, listener: (arg: never) => void) => void (handlers[event] = listener)) as AutoUpdaterLike['on'],
    async checkForUpdates() {
      updater.checks++
      return check()
    },
    quitAndInstall() {
      updater.installs++
    }
  }
  return { updater, emit: (event: string, arg: unknown) => handlers[event]?.(arg as never) }
}

const make = (opts: { isPackaged: boolean; updater?: ReturnType<typeof fakeUpdater> }) => {
  const f = opts.updater ?? fakeUpdater()
  const logs: string[] = []
  const factory = vi.fn(() => f.updater)
  const checker = createUpdateChecker({ isPackaged: opts.isPackaged, autoUpdater: factory, log: (m) => void logs.push(m) })
  return { checker, f, logs, factory }
}

describe('update checker', () => {
  it('does not check (and does not even touch the updater) when the app is not packaged', async () => {
    const { checker, f, factory } = make({ isPackaged: false })
    await checker.start()
    expect(factory).not.toHaveBeenCalled()
    expect(f.updater.checks).toBe(0)
    expect(checker.state()).toEqual({ status: 'none' })
    expect(checker.install()).toBe(false)
  })

  it('a packaged app checks once at start (a second start does nothing), and never installs by itself', async () => {
    const { checker, f } = make({ isPackaged: true })
    await checker.start()
    await checker.start()
    expect(f.updater.checks).toBe(1)
    expect(f.updater.autoDownload).toBe(true) // 내려받기만
    expect(f.updater.autoInstallOnAppQuit).toBe(false) // 앱을 끌 때 몰래 설치하지 않는다
    expect(f.updater.installs).toBe(0)
  })

  it('a failed check (offline, no release, thrown) is quiet: only a log line, the state stays "none", start never throws', async () => {
    const failing = fakeUpdater(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    const { checker, logs } = make({ isPackaged: true, updater: failing })
    await expect(checker.start()).resolves.toBeUndefined()
    expect(checker.state()).toEqual({ status: 'none' })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('update check failed')
  })

  it('a failure while creating the updater is quiet too', async () => {
    const logs: string[] = []
    const checker = createUpdateChecker({
      isPackaged: true,
      autoUpdater: () => {
        throw new Error('electron-updater could not load')
      },
      log: (m) => void logs.push(m)
    })
    await expect(checker.start()).resolves.toBeUndefined()
    expect(logs).toHaveLength(1)
  })

  it('an updater error event is only logged', async () => {
    const { checker, f, logs } = make({ isPackaged: true })
    await checker.start()
    f.emit('error', new Error('signature mismatch'))
    expect(logs).toEqual(['update error: signature mismatch'])
    expect(checker.state()).toEqual({ status: 'none' })
  })

  it('available → "downloading", downloaded → "ready"; installing is refused until it is ready and only happens when asked', async () => {
    const { checker, f } = make({ isPackaged: true })
    await checker.start()

    f.emit('update-available', { version: '0.2.0' })
    expect(checker.state()).toEqual({ status: 'downloading', version: '0.2.0' })
    expect(checker.install()).toBe(false)
    expect(f.updater.installs).toBe(0)

    f.emit('update-downloaded', { version: '0.2.0' })
    expect(checker.state()).toEqual({ status: 'ready', version: '0.2.0' })
    expect(f.updater.installs).toBe(0) // 내려받았다고 설치하지 않는다

    expect(checker.install()).toBe(true)
    expect(f.updater.installs).toBe(1)
  })
})

describe('update IPC', () => {
  it('state is passed through; install only acts when ready; without a checker it is a harmless no-op', () => {
    const { checker, f } = make({ isPackaged: true })
    const handlers = createUpdateHandlers({ getChecker: () => checker })
    expect(handlers.state()).toEqual({ ok: true, data: { status: 'none' } })
    expect(handlers.install()).toEqual({ ok: true, data: null })
    expect(f.updater.installs).toBe(0)

    const none = createUpdateHandlers({ getChecker: () => null })
    expect(none.state()).toEqual({ ok: true, data: { status: 'none' } })
    expect(none.install()).toEqual({ ok: true, data: null })
  })

  it('registers exactly two channels, and install takes no arguments', () => {
    const handle = vi.fn()
    registerUpdateHandlers({ handle }, createUpdateHandlers({ getChecker: () => null }))
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual([IPC.updateInstall, IPC.updateState].sort())
  })
})

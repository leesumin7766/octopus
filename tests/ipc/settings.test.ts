import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { createSettingsRepository, type SettingsRepository } from '../../src/main/core/settings/settingsRepository'
import type { IpcMainLike } from '../../src/main/ipc/result'
import { createSettingsHandlers, registerSettingsHandlers, type SettingsHandlers } from '../../src/main/ipc/settings'
import { defaultLayout, moveCard } from '../../src/shared/home/layout'
import { IPC } from '../../src/shared/ipc'

interface Setup {
  db: DatabaseSync
  handlers: SettingsHandlers
  logged: { channel: string; error: unknown }[]
}

function setup(repository?: (repo: SettingsRepository) => SettingsRepository | null): Setup {
  const db = new DatabaseSync(':memory:')
  runMigrations(db, migrations)
  const repo = createSettingsRepository(db)
  const logged: Setup['logged'] = []
  const handlers = createSettingsHandlers({
    getRepository: () => (repository ? repository(repo) : repo),
    logError: (channel, error) => logged.push({ channel, error })
  })
  return { db, handlers, logged }
}

describe('settings IPC handlers', () => {
  let current: Setup | undefined
  const s = (repository?: Parameters<typeof setup>[0]): Setup => (current = setup(repository))

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

  it('get returns the default and then what was set', () => {
    const { handlers } = s()
    expect(handlers.get('nav.collapsed')).toEqual({ ok: true, data: false })
    expect(handlers.get('home.layout')).toEqual({ ok: true, data: defaultLayout() })

    expect(handlers.set('nav.collapsed', true)).toEqual({ ok: true, data: true })
    const layout = moveCard(defaultLayout(), 'memo', 'right')
    expect(handlers.set('home.layout', layout)).toEqual({ ok: true, data: layout })

    expect(handlers.get('nav.collapsed')).toEqual({ ok: true, data: true })
    expect(handlers.get('home.layout')).toEqual({ ok: true, data: layout })
  })

  it('rejects keys it does not know', () => {
    const { handlers, db } = s()

    for (const key of ['home', 'nav.expanded', '', null, undefined, 5, {}, '__proto__']) {
      invalid(handlers.get(key), 'key')
      invalid(handlers.set(key, true), 'key')
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key LIKE 'settings.%'").get()).toEqual({ n: 0 })
  })

  it('rejects values of the wrong shape and stores nothing', () => {
    const { handlers, db } = s()

    invalid(handlers.set('nav.collapsed', 'true'), 'value')
    invalid(handlers.set('nav.collapsed', 1), 'value')
    invalid(handlers.set('nav.collapsed', undefined), 'value')
    invalid(handlers.set('home.layout', 'wide'), 'value')
    invalid(handlers.set('home.layout', { version: 1, order: ['todo'], col: 50, row: 50 }), 'value')
    invalid(handlers.set('home.layout', { ...defaultLayout(), col: 'half' }), 'value')
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key LIKE 'settings.%'").get()).toEqual({ n: 0 })
  })

  it('never puts the input in the response', () => {
    const { handlers } = s()
    const secret = 'SECRET-SETTING-TEXT'

    const results = [handlers.set('nav.collapsed', secret), handlers.set(secret, true), handlers.get(secret)]

    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(secret)
    }
  })

  it('db_unavailable when there is no repository, but a wrong key is still invalid_input', () => {
    const { handlers } = s(() => null)

    expect(handlers.get('nav.collapsed')).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    expect(handlers.set('nav.collapsed', true)).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    invalid(handlers.get('nope'), 'key')
    invalid(handlers.set('nav.collapsed', 'x'), 'value')
  })

  it('internal errors hide the original message and are logged', () => {
    const boom = new Error('SECRET db path')
    const { handlers, logged } = s(() => ({ get: () => { throw boom }, set: () => { throw boom } }) as unknown as SettingsRepository)

    const result = handlers.get('nav.collapsed')

    expect(result).toEqual({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(logged).toEqual([{ channel: IPC.settingsGet, error: boom }])
  })

  it('a real database failure is internal too', () => {
    const { handlers, db } = s()
    db.close()

    expect(handlers.set('nav.collapsed', true)).toEqual({ ok: false, error: { code: 'internal' } })
  })

  it('registerSettingsHandlers wires both channels', () => {
    const { handlers } = s()
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }

    registerSettingsHandlers(ipc, handlers)

    const channels = Object.values(IPC).filter((channel) => channel.startsWith('settings:'))
    expect([...registered.keys()].sort()).toEqual([...channels].sort())
    const call = (channel: string, ...args: unknown[]): unknown => registered.get(channel)?.({ sender: 'x' }, ...args)
    expect(call(IPC.settingsSet, 'nav.collapsed', true)).toEqual({ ok: true, data: true })
    expect(call(IPC.settingsGet, 'nav.collapsed')).toEqual({ ok: true, data: true })
  })
})

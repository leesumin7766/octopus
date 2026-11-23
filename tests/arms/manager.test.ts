import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SYNC_MINUTES, REASONS } from '../../src/main/arms/sdk/manager'
import { ArmError } from '../../src/main/arms/sdk/types'
import type { CommandTool } from '../../src/main/core/command/tools/registry'
import { createManagerEnv, fakeArm } from './helpers'

const tool = (name: string): CommandTool => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  readOnly: true,
  parse: () => ({ ok: true, value: null }),
  run: () => name
})

describe('ArmManager: registration', () => {
  it('registers valid arms, lists them as off, and rejects a bad or repeated manifest without throwing', () => {
    const e = createManagerEnv()
    expect(e.manager.register(fakeArm())).toEqual({ ok: true })
    expect(e.manager.register(fakeArm())).toMatchObject({ ok: false }) // 같은 id
    expect(e.manager.register(fakeArm({ manifest: { id: 'BAD ID' } }))).toMatchObject({ ok: false })
    expect(e.manager.register({} as never)).toMatchObject({ ok: false })

    expect(e.manager.list()).toMatchObject([{ id: 'test-arm', name: '테스트 Arm', status: { state: 'off' }, autoAccept: false }])
  })
})

describe('ArmManager: connect', () => {
  it('connect success: on, remembered in settings, sync scheduled (15 min by default) and run once at once', async () => {
    const e = createManagerEnv()
    const sync = vi.fn(async () => ({ added: 0 }))
    e.manager.register(fakeArm({ sync }))

    const info = await e.manager.connect('test-arm')

    expect(info?.status).toEqual({ state: 'on' })
    expect(e.settings.connected).toEqual(['test-arm'])
    expect(sync).toHaveBeenCalledTimes(1)
    expect(e.scheduler.intervals).toEqual([DEFAULT_SYNC_MINUTES * 60_000])
    e.scheduler.tick()
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
  })

  it('the arm can change the sync interval in its manifest', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ manifest: { syncIntervalMinutes: 5 }, sync: async () => ({}) }))
    await e.manager.connect('test-arm')
    expect(e.scheduler.intervals).toEqual([300_000])
  })

  it('no sync, no schedule', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm())
    await e.manager.connect('test-arm')
    expect(e.scheduler.active()).toBe(0)
  })

  it('connect() that throws ends as error with a generic reason — the exception never leaks, nothing is remembered', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ connect: async () => { throw new Error('ECONNREFUSED https://secret.host token=abc') } }))

    const info = await e.manager.connect('test-arm')

    expect(info?.status).toEqual({ state: 'error', reason: REASONS.connectFailed })
    expect(JSON.stringify(info)).not.toMatch(/secret|abc/)
    expect(e.settings.connected).toEqual([])
    expect(e.scheduler.active()).toBe(0)
  })

  it('an ArmError message is shown as the reason', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ connect: async () => { throw new ArmError('로그인 창이 닫혔어요. 다시 눌러 주세요.') } }))
    expect((await e.manager.connect('test-arm'))?.status).toEqual({ state: 'error', reason: '로그인 창이 닫혔어요. 다시 눌러 주세요.' })
  })

  it('a rejected promise that is not an Error, and a synchronous throw, are both caught', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ manifest: { id: 'a-one' }, connect: () => Promise.reject('plain string') }))
    const sync = fakeArm({ manifest: { id: 'a-two' } })
    sync.connect = () => {
      throw new TypeError('sync boom')
    }
    e.manager.register(sync)

    expect((await e.manager.connect('a-one'))?.status.state).toBe('error')
    expect((await e.manager.connect('a-two'))?.status.state).toBe('error')
  })

  it('a connect that never finishes is cut off by the time limit and ends as error', async () => {
    const e = createManagerEnv({ connectTimeoutMs: 30 })
    e.manager.register(fakeArm({ connect: () => new Promise(() => {}) }))

    const info = await e.manager.connect('test-arm')

    expect(info?.status).toEqual({ state: 'error', reason: REASONS.connectTimeout })
  })

  it('a late rejection after the time limit does not become an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const e = createManagerEnv({ connectTimeoutMs: 10 })
      e.manager.register(fakeArm({ connect: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 40)) }))
      await e.manager.connect('test-arm')
      await new Promise((r) => setTimeout(r, 80))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('shows "connecting" while it works, and two connects at once run connect() only once', async () => {
    const e = createManagerEnv()
    let release: () => void = () => {}
    const connect = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    e.manager.register(fakeArm({ connect }))

    const first = e.manager.connect('test-arm')
    const second = e.manager.connect('test-arm')
    expect(e.manager.get('test-arm')?.status.state).toBe('connecting')
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    release()
    await Promise.all([first, second])

    expect(connect).toHaveBeenCalledTimes(1)
    expect(e.manager.get('test-arm')?.status.state).toBe('on')
  })

  it('an unknown id gives undefined, never an exception', async () => {
    const e = createManagerEnv()
    expect(await e.manager.connect('nope')).toBeUndefined()
    expect(await e.manager.disconnect('nope')).toBeUndefined()
    expect(await e.manager.syncNow('nope')).toBeUndefined()
    expect(e.manager.setAutoAccept('nope', true)).toBeUndefined()
  })

  it('the arm sees interactive=true on a click, and only the context it was given (its own secrets)', async () => {
    const e = createManagerEnv()
    const arm = fakeArm({ connect: async (ctx) => ctx.secrets.set('token', 'T1') })
    e.manager.register(arm)
    await e.manager.connect('test-arm')
    expect(arm.contexts[0].interactive).toBe(true)
    expect(e.store.get('arm:test-arm', 'token')).toBe('T1')
  })
})

describe('ArmManager: sync', () => {
  it('a sync that throws or hangs turns the status into error and does not escape; the next good sync recovers', async () => {
    const e = createManagerEnv({ syncTimeoutMs: 30 })
    let mode: 'ok' | 'throw' | 'hang' = 'throw'
    e.manager.register(
      fakeArm({
        sync: async () => {
          if (mode === 'throw') throw new Error('api exploded')
          if (mode === 'hang') return new Promise(() => {})
          return {}
        }
      })
    )

    const first = await e.manager.connect('test-arm')
    expect(first?.status).toEqual({ state: 'error', reason: REASONS.syncFailed })
    expect(e.settings.connected).toEqual(['test-arm']) // 연결은 유지된다

    mode = 'hang'
    expect((await e.manager.syncNow('test-arm'))?.status).toEqual({ state: 'error', reason: REASONS.syncTimeout })

    mode = 'ok'
    expect((await e.manager.syncNow('test-arm'))?.status).toEqual({ state: 'on' })
  })

  it('syncs do not overlap', async () => {
    const e = createManagerEnv()
    let running = 0
    let peak = 0
    e.manager.register(
      fakeArm({
        sync: async () => {
          running++
          peak = Math.max(peak, running)
          await new Promise((r) => setTimeout(r, 20))
          running--
          return {}
        }
      })
    )
    await e.manager.connect('test-arm')
    await Promise.all([e.manager.syncNow('test-arm'), e.manager.syncNow('test-arm'), e.manager.syncNow('test-arm')])
    expect(peak).toBe(1)
  })

  it('when the arm itself reports an error (e.g. an expired token) the card shows it', async () => {
    const e = createManagerEnv()
    let own: ReturnType<ReturnType<typeof fakeArm>['status']> = { state: 'on' }
    e.manager.register(fakeArm({ status: () => own }))
    await e.manager.connect('test-arm')
    expect(e.manager.get('test-arm')?.status.state).toBe('on')

    own = { state: 'error', reason: '토큰이 만료됐어요.' }
    expect(e.manager.get('test-arm')?.status).toEqual({ state: 'error', reason: '토큰이 만료됐어요.' })
    own = { state: 'error' }
    expect(e.manager.get('test-arm')?.status.reason).toBe(REASONS.armStatus)
  })

  it('an arm whose status() throws does not break listing', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ status: () => { throw new Error('x') } }))
    await e.manager.connect('test-arm')
    expect(e.manager.list()[0].status.state).toBe('on')
  })

  it('candidates the arm sends go through core.addInboxCandidate with this arm as the source', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ sync: async () => ({}), connect: async (ctx) => void ctx.core.addInboxCandidate({ ref: 'r1', title: 't' }) }))
    await e.manager.connect('test-arm')
    expect(e.added).toEqual([{ armId: 'test-arm', ref: 'r1' }])
  })
})

describe('ArmManager: disconnect', () => {
  it('deletes the arm secret namespace entirely, leaves other arms alone, stops the schedule, forgets the connection', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ sync: async () => ({}), connect: async (ctx) => { ctx.secrets.set('a', '1'); ctx.secrets.set('b', '2') } }))
    e.manager.register(fakeArm({ manifest: { id: 'other-arm' }, connect: async (ctx) => ctx.secrets.set('a', 'keep') }))
    await e.manager.connect('test-arm')
    await e.manager.connect('other-arm')
    expect(e.scheduler.active()).toBe(1)

    const info = await e.manager.disconnect('test-arm')

    expect(info?.status).toEqual({ state: 'off' })
    expect(e.store.get('arm:test-arm', 'a')).toBeUndefined()
    expect(e.store.get('arm:test-arm', 'b')).toBeUndefined()
    expect(e.store.get('arm:other-arm', 'a')).toBe('keep')
    expect(e.scheduler.active()).toBe(0)
    expect(e.settings.connected).toEqual(['other-arm'])
  })

  it('still deletes the secrets and ends "off" when the arm\'s own disconnect() throws', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ connect: async (ctx) => ctx.secrets.set('a', '1'), disconnect: async () => { throw new Error('cannot revoke') } }))
    await e.manager.connect('test-arm')

    const info = await e.manager.disconnect('test-arm')

    expect(info?.status).toEqual({ state: 'off' })
    expect(e.store.get('arm:test-arm', 'a')).toBeUndefined()
  })

  it('works on an arm that failed to connect (error → off)', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ connect: async () => { throw new Error('x') } }))
    await e.manager.connect('test-arm')
    expect((await e.manager.disconnect('test-arm'))?.status.state).toBe('off')
  })

  it('removes the arm tools at once', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ tools: () => [tool('arm_search')] }))
    expect(e.manager.tools()).toEqual([])
    await e.manager.connect('test-arm')
    expect(e.manager.tools().map((t) => [t.name, t.source])).toEqual([['arm_search', 'arm:test-arm']])

    await e.manager.disconnect('test-arm')

    expect(e.manager.tools()).toEqual([])
  })
})

describe('ArmManager: tools', () => {
  it('a tools() that throws is skipped, other arms keep theirs; failed arms offer no tools', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ manifest: { id: 'bad-tools' }, tools: () => { throw new Error('x') } }))
    e.manager.register(fakeArm({ manifest: { id: 'good-tools' }, tools: () => [tool('t1')] }))
    e.manager.register(fakeArm({ manifest: { id: 'broken' }, connect: async () => { throw new Error('x') }, tools: () => [tool('t2')] }))
    for (const id of ['bad-tools', 'good-tools', 'broken']) await e.manager.connect(id)

    expect(e.manager.tools().map((t) => t.name)).toEqual(['t1'])
  })
})

describe('ArmManager: start (automatic reconnect)', () => {
  it('reconnects the arms that were connected before, quietly (interactive=false); others stay off', async () => {
    const e = createManagerEnv()
    e.settings.connected = ['test-arm']
    const a = fakeArm()
    const b = fakeArm({ manifest: { id: 'not-before' } })
    e.manager.register(a)
    e.manager.register(b)

    await e.manager.start()

    expect(a.contexts[0].interactive).toBe(false)
    expect(b.contexts).toHaveLength(0)
    expect(e.manager.get('test-arm')?.status.state).toBe('on')
    expect(e.manager.get('not-before')?.status.state).toBe('off')
  })

  it('a failed reconnect shows "log in again", keeps the arm in the remembered list, and does not stop the others', async () => {
    const e = createManagerEnv()
    e.settings.connected = ['test-arm', 'second-arm']
    e.manager.register(fakeArm({ connect: async () => { throw new Error('token expired') } }))
    e.manager.register(fakeArm({ manifest: { id: 'second-arm' } }))

    await e.manager.start()

    expect(e.manager.get('test-arm')?.status).toEqual({ state: 'error', reason: REASONS.reconnectNeeded })
    expect(e.manager.get('second-arm')?.status.state).toBe('on')
    expect(e.settings.connected).toEqual(['test-arm', 'second-arm'])
  })

  it('a stale schedule tick on an arm that never connected does nothing', async () => {
    const e = createManagerEnv()
    const sync = vi.fn(async () => ({}))
    e.settings.connected = ['test-arm']
    e.manager.register(fakeArm({ connect: async () => { throw new Error('x') }, sync }))
    await e.manager.start()
    e.scheduler.tick()
    expect(sync).not.toHaveBeenCalled()
  })
})

describe('ArmManager: notifications and auto-accept', () => {
  it('tells listeners when a status changes, survives a listener that throws, and can unsubscribe', async () => {
    const e = createManagerEnv()
    const seen: string[] = []
    e.manager.onChange(() => { throw new Error('bad listener') })
    const off = e.manager.onChange(() => void seen.push(e.manager.get('test-arm')?.status.state ?? '-'))
    e.manager.register(fakeArm())

    await e.manager.connect('test-arm')
    expect(seen).toContain('connecting')
    expect(seen.at(-1)).toBe('on')

    off()
    const count = seen.length
    await e.manager.disconnect('test-arm')
    expect(seen).toHaveLength(count)
  })

  it('auto-accept is remembered in settings and shown on the arm', () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm())
    expect(e.manager.setAutoAccept('test-arm', true)?.autoAccept).toBe(true)
    expect(e.settings.autoAccept).toEqual(['test-arm'])
    expect(e.manager.setAutoAccept('test-arm', false)?.autoAccept).toBe(false)
    expect(e.settings.autoAccept).toEqual([])
  })

  it('dispose stops every schedule', async () => {
    const e = createManagerEnv()
    e.manager.register(fakeArm({ sync: async () => ({}) }))
    await e.manager.connect('test-arm')
    e.manager.dispose()
    expect(e.scheduler.active()).toBe(0)
  })
})

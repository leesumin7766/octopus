import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArmManager } from '../../src/main/arms/sdk/manager'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { createCandidateRepository } from '../../src/main/core/inbox/candidateRepository'
import { createTaskRepository } from '../../src/main/core/tasks/taskRepository'
import { createArmsHandlers, createCandidateHandlers, registerArmsHandlers } from '../../src/main/ipc/arms'
import { IPC } from '../../src/shared/ipc'
import { fakeArm } from '../arms/helpers'

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

function setup(opts: { noDb?: boolean } = {}) {
  const db = new DatabaseSync(':memory:')
  runMigrations(db, migrations)
  const now = () => new Date('2026-03-10T09:00:00.000Z')
  const tasks = createTaskRepository(db, { now })
  let n = 0
  const candidates = createCandidateRepository(db, { newId: () => `01ARZ3NDEKTSV4RRFFQ69G5F${String(10 + n++).padStart(2, '0')}`, now, tasks })
  const settings = { connected: [] as string[], autoAccept: [] as string[] }
  const manager = createArmManager({
    secureStore: createMemorySecureStore(),
    settings: {
      getConnected: () => settings.connected,
      setConnected: (ids) => void (settings.connected = ids),
      getAutoAccept: () => settings.autoAccept,
      setAutoAccept: (ids) => void (settings.autoAccept = ids)
    },
    coreFor: () => ({ addInboxCandidate: () => ({ added: true, accepted: false }), listTasks: () => [] }),
    http: { fetch: async () => { throw new Error('no network') }, sleep: async () => {} },
    logSink: () => {},
    scheduler: { setInterval: () => 0, clearInterval: () => {} }
  })
  manager.register(fakeArm({ manifest: { id: 'example' } }))
  const opened: string[] = []
  const logged: unknown[] = []
  const deps = {
    getManager: () => (opts.noDb ? null : manager),
    getCandidates: () => (opts.noDb ? null : candidates),
    openExternal: async (url: string) => void opened.push(url),
    logError: (_c: string, e: unknown) => void logged.push(e)
  }
  return { db, tasks, candidates, manager, opened, logged, arms: createArmsHandlers(deps), cand: createCandidateHandlers(deps) }
}

describe('arms IPC handlers', () => {
  let current: ReturnType<typeof setup> | undefined
  const s = (opts?: Parameters<typeof setup>[0]) => (current = setup(opts))
  afterEach(() => {
    try {
      current?.db.close()
    } catch {
      // 이미 닫힘
    }
  })

  it('list / connect / disconnect return the arm info; connect failures are a status, not an IPC error', async () => {
    const { arms, manager } = s()
    expect(arms.list()).toMatchObject({ ok: true, data: [{ id: 'example', status: { state: 'off' } }] })
    expect(await arms.connect('example')).toMatchObject({ ok: true, data: { id: 'example', status: { state: 'on' } } })
    expect(await arms.disconnect('example')).toMatchObject({ ok: true, data: { status: { state: 'off' } } })

    manager.register(fakeArm({ manifest: { id: 'broken' }, connect: async () => { throw new Error('x') } }))
    expect(await arms.connect('broken')).toMatchObject({ ok: true, data: { status: { state: 'error' } } })
  })

  it('validates ids and values; unknown arm is not_found', async () => {
    const { arms } = s()
    expect(await arms.connect('Bad Id')).toMatchObject({ ok: false, error: { code: 'invalid_input', fields: ['id'] } })
    expect(await arms.connect(5)).toMatchObject({ ok: false })
    expect(await arms.disconnect('../etc')).toMatchObject({ ok: false })
    expect(await arms.connect('nope')).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(arms.setAutoAccept('example', 'yes')).toMatchObject({ ok: false, error: { fields: ['on'] } })
    expect(arms.setAutoAccept('nope', true)).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(arms.setAutoAccept('example', true)).toMatchObject({ ok: true, data: { autoAccept: true } })
  })

  it('without a database every channel says db_unavailable', async () => {
    const { arms, cand } = s({ noDb: true })
    expect(arms.list()).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    expect(await arms.connect('example')).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    expect(cand.list()).toEqual({ ok: false, error: { code: 'db_unavailable' } })
  })

  it('registers exactly the arms and candidate channels', () => {
    const { arms, cand } = s()
    const handle = vi.fn()
    registerArmsHandlers({ handle }, arms, cand)
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual(
      [IPC.armsList, IPC.armsConnect, IPC.armsDisconnect, IPC.armsSetAutoAccept, IPC.armsSetClient, IPC.candidatesList, IPC.candidatesAccept, IPC.candidatesDismiss, IPC.candidatesAcceptAll, IPC.candidatesDismissAll, IPC.candidatesOpenSource].sort()
    )
  })
})

describe('candidate IPC handlers', () => {
  let current: ReturnType<typeof setup> | undefined
  afterEach(() => current?.db.close())

  it('list → accept makes an inbox task; dismiss hides; both validate ids and answer not_found for gone ones', () => {
    const e = (current = setup())
    e.candidates.add('example', { ref: 'r1', title: '하나', url: 'https://example.com/1' })
    e.candidates.add('example', { ref: 'r2', title: '둘' })
    const [first, second] = (e.cand.list() as { data: { id: string }[] }).data

    expect(e.cand.accept(first.id)).toMatchObject({ ok: true, data: { title: '하나', source: { arm: 'example', ref: 'r1' } } })
    expect(e.cand.dismiss(second.id)).toEqual({ ok: true, data: null })
    expect(e.cand.list()).toEqual({ ok: true, data: [] })
    expect(e.cand.accept(first.id)).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(e.cand.accept('nope')).toMatchObject({ ok: false, error: { code: 'invalid_input', fields: ['id'] } })
    expect(e.cand.dismiss(ID)).toEqual({ ok: false, error: { code: 'not_found' } })
  })

  it('acceptAll and dismissAll answer with how many', () => {
    const e = (current = setup())
    for (const r of ['1', '2', '3']) e.candidates.add('example', { ref: r, title: `일 ${r}` })
    expect(e.cand.acceptAll()).toEqual({ ok: true, data: 3 })
    e.candidates.add('example', { ref: '4', title: 'x' })
    expect(e.cand.dismissAll()).toEqual({ ok: true, data: 1 })
  })

  it('openSource opens only the stored http(s) address of that candidate, by id', async () => {
    const e = (current = setup())
    e.candidates.add('example', { ref: 'r1', title: '하나', url: 'https://example.com/1' })
    e.candidates.add('example', { ref: 'r2', title: '링크 없음' })
    const [withUrl, without] = (e.cand.list() as { data: { id: string }[] }).data

    expect(await e.cand.openSource(withUrl.id)).toEqual({ ok: true, data: null })
    expect(e.opened).toEqual(['https://example.com/1'])
    expect(await e.cand.openSource(without.id)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(await e.cand.openSource(ID)).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await e.cand.openSource('https://evil.example/')).toMatchObject({ ok: false, error: { code: 'invalid_input' } }) // 주소를 보내는 길은 없다
    expect(e.opened).toHaveLength(1)
  })

  it('a stored non-http address is never opened even if it got into the table some other way', async () => {
    const e = (current = setup())
    e.db.prepare("INSERT INTO inbox_candidates (id, arm_id, ref, title, url, created_at, status) VALUES (?, 'x', 'r', 't', 'file:///c:/windows/system32/calc.exe', 'now', 'pending')").run(ID)
    expect(await e.cand.openSource(ID)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(e.opened).toEqual([])
  })
})

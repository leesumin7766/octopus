import { afterEach, describe, expect, it } from 'vitest'
import { createRoutineRepository, type RoutineRepository } from '../../src/main/core/routines/routineRepository'
import {
  createRoutineHandlers,
  registerRoutineHandlers,
  type RoutineHandlers
} from '../../src/main/ipc/routines'
import type { IpcMainLike } from '../../src/main/ipc/result'
import { IPC, type IpcResult } from '../../src/shared/ipc'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

const NOON = (day: number): Date => new Date(2026, 2, day, 12, 0, 0) // 2026-03-10 은 화요일
const MISSING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

interface Setup {
  t: TestRepo
  repo: RoutineRepository
  handlers: RoutineHandlers
  logged: { channel: string; error: unknown }[]
  setNow(date: Date): void
}

function setup(repository?: (repo: RoutineRepository) => RoutineRepository | null): Setup {
  const t = createTestRepo(NOON(10).toISOString())
  let now = NOON(10)
  const repo = createRoutineRepository(t.db, { now: () => now, tasks: t.repo })
  const logged: Setup['logged'] = []
  const handlers = createRoutineHandlers({
    getRepository: () => (repository ? repository(repo) : repo),
    now: () => now,
    logError: (channel, error) => logged.push({ channel, error })
  })
  return {
    t,
    repo,
    handlers,
    logged,
    setNow(date) {
      now = date
      t.setNow(date.toISOString())
    }
  }
}

function data<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`expected ok but got ${JSON.stringify(result.error)}`)
  return result.data
}

describe('routine IPC handlers', () => {
  let current: Setup | undefined
  const s = (repository?: Parameters<typeof setup>[0]): Setup => (current = setup(repository))

  afterEach(() => {
    try {
      current?.t.db.close()
    } catch {
      // 테스트가 이미 닫은 DB
    }
    current = undefined
  })

  const invalid = (result: IpcResult<unknown>, ...fields: string[]): void =>
    expect(result).toEqual({ ok: false, error: { code: 'invalid_input', fields } })

  describe('normal calls', () => {
    it('create makes the routine and today\'s item; list returns both', () => {
      const { handlers } = s()

      const routine = data(handlers.create({ title: '  스트레칭  ', days: [5, 2, 2] })) // 화·금
      expect(routine).toMatchObject({ title: '스트레칭', days: [2, 5], active: true })

      const listed = data(handlers.list())
      expect(listed.routines).toHaveLength(1)
      expect(listed.todayItems.map((task) => task.title)).toEqual(['스트레칭']) // 오늘은 화요일
    })

    it('list creates today\'s items once, however many times it is called', () => {
      const { handlers } = s()
      data(handlers.create({ title: '매일', days: EVERY_DAY }))

      const first = data(handlers.list())
      const second = data(handlers.list())

      expect(first.todayItems).toHaveLength(1)
      expect(second.todayItems.map((task) => task.id)).toEqual(first.todayItems.map((task) => task.id))
    })

    it('list creates the item for a new day (main decides what "today" is)', () => {
      const { handlers, setNow } = s()
      data(handlers.create({ title: '매일', days: EVERY_DAY }))

      setNow(NOON(11))
      const next = data(handlers.list())

      expect(next.todayItems.map((task) => task.date)).toEqual(['2026-03-11'])
    })

    it('update, remove and history', () => {
      const { handlers } = s()
      const routine = data(handlers.create({ title: '매일', days: EVERY_DAY }))

      expect(data(handlers.update(routine.id, { title: '새 이름', active: false }))).toMatchObject({
        title: '새 이름',
        active: false
      })
      expect(data(handlers.history(undefined)).dates).toHaveLength(14)
      expect(data(handlers.history(3)).dates).toEqual(['2026-03-08', '2026-03-09', '2026-03-10'])
      expect(data(handlers.history(undefined)).routines[0]).toMatchObject({ id: routine.id, title: '새 이름' })

      expect(data(handlers.remove(routine.id))).toBeNull()
      expect(data(handlers.list()).routines).toEqual([])
    })
  })

  describe('invalid input', () => {
    it('rejects malformed creates', () => {
      const { handlers, t } = s()

      invalid(handlers.create(null), 'input')
      invalid(handlers.create('x'), 'input')
      invalid(handlers.create({ title: 'a', days: [1], order: 1 }), 'input')
      invalid(handlers.create({ days: [1] }), 'title')
      invalid(handlers.create({ title: 'a' }), 'days')
      invalid(handlers.create({ title: 'a', days: '1' }), 'days')
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM routines').get()).toEqual({ n: 0 })
    })

    it('reports the field the repository found wrong', () => {
      const { handlers } = s()

      invalid(handlers.create({ title: '  ', days: [1] }), 'title')
      invalid(handlers.create({ title: 'a', days: [] }), 'days')
      invalid(handlers.create({ title: 'a', days: [9] }), 'days')
      invalid(handlers.create({ title: 'a', days: [1], active: 'yes' }), 'active')
      invalid(handlers.create({ title: '', days: [] }), 'title', 'days')
    })

    it('rejects ids and patches it does not accept', () => {
      const { handlers } = s()
      const routine = data(handlers.create({ title: 'a', days: [1] }))

      invalid(handlers.update('nope', { title: 'x' }), 'id')
      invalid(handlers.update(routine.id, { id: 'x' }), 'patch')
      invalid(handlers.update(routine.id, { order: 3 }), 'patch')
      invalid(handlers.update(routine.id, 'x'), 'patch')
      invalid(handlers.update(routine.id, { days: [] }), 'days')
      invalid(handlers.remove(5), 'id')
    })

    it('rejects a bad history range', () => {
      const { handlers } = s()

      for (const days of [0, 91, 1.5, '14', -1, {}]) invalid(handlers.history(days), 'days')
      expect(handlers.history(null).ok).toBe(true)
    })

    it('never puts the user input in the response', () => {
      const { handlers } = s()
      const secret = 'SECRET-ROUTINE-TEXT'

      const results = [
        handlers.create({ title: secret, days: [99] }),
        handlers.create({ [secret]: 1 }),
        handlers.update(secret, {})
      ]

      for (const result of results) {
        expect(result.ok).toBe(false)
        expect(JSON.stringify(result)).not.toContain(secret)
      }
    })
  })

  it('not_found for unknown routines', () => {
    const { handlers } = s()
    const notFound = { ok: false, error: { code: 'not_found' } }

    expect(handlers.update(MISSING_ID, { title: 'x' })).toEqual(notFound)
    expect(handlers.remove(MISSING_ID)).toEqual(notFound)
  })

  it('db_unavailable when there is no repository', () => {
    const { handlers } = s(() => null)
    const unavailable = { ok: false, error: { code: 'db_unavailable' } }

    expect(handlers.list()).toEqual(unavailable)
    expect(handlers.create({ title: 'a', days: [1] })).toEqual(unavailable)
    expect(handlers.update(MISSING_ID, { title: 'x' })).toEqual(unavailable)
    expect(handlers.remove(MISSING_ID)).toEqual(unavailable)
    expect(handlers.history(7)).toEqual(unavailable)
    invalid(handlers.create(null), 'input') // 형식 오류는 DB 가 없어도 그대로
  })

  it('internal errors hide the original message and are logged', () => {
    const boom = new Error('SECRET db path')
    const { handlers, logged } = s(() => ({ list: () => { throw boom } }) as unknown as RoutineRepository)

    const result = handlers.history(7)
    expect(result).toEqual({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    // history 는 list 를 거치므로 위에서 던진다
    expect(logged).toEqual([{ channel: IPC.routinesHistory, error: expect.anything() }])
  })

  it('registerRoutineHandlers wires every routines channel', () => {
    const { handlers } = s()
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }

    registerRoutineHandlers(ipc, handlers)

    const channels = Object.values(IPC).filter((channel) => channel.startsWith('routines:'))
    expect([...registered.keys()].sort()).toEqual([...channels].sort())

    const call = (channel: string, ...args: unknown[]): unknown => registered.get(channel)?.({ sender: 'x' }, ...args)
    const created = data(call(IPC.routinesCreate, { title: 'a', days: EVERY_DAY }) as IpcResult<{ id: string }>)
    expect(call(IPC.routinesUpdate, created.id, { title: 'b' })).toMatchObject({ ok: true, data: { title: 'b' } })
    expect(call(IPC.routinesList)).toMatchObject({ ok: true, data: { routines: [{ id: created.id }] } })
    expect(call(IPC.routinesHistory, 2)).toMatchObject({ ok: true, data: { dates: ['2026-03-09', '2026-03-10'] } })
    expect(call(IPC.routinesRemove, created.id)).toEqual({ ok: true, data: null })
  })
})

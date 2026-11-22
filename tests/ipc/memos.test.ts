import { afterEach, describe, expect, it } from 'vitest'
import { createMemoRepository, type MemoRepository } from '../../src/main/core/memos/memoRepository'
import { createMemoHandlers, registerMemoHandlers, type MemoHandlers } from '../../src/main/ipc/memos'
import type { IpcMainLike } from '../../src/main/ipc/result'
import { IPC, type IpcResult } from '../../src/shared/ipc'
import { MAX_MEMO_LENGTH } from '../../src/shared/validation/memo'
import { MAX_SEARCH_LENGTH } from '../../src/shared/validation/memoIpc'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

const NOON = (day: number): Date => new Date(2026, 2, day, 12, 0, 0)
const MISSING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

interface Setup {
  t: TestRepo
  handlers: MemoHandlers
  logged: { channel: string; error: unknown }[]
  setNow(date: Date): void
}

function setup(repository?: (repo: MemoRepository) => MemoRepository | null): Setup {
  const t = createTestRepo(NOON(10).toISOString())
  let now = NOON(10)
  const repo = createMemoRepository(t.db, { now: () => now, tasks: t.repo })
  const logged: Setup['logged'] = []
  const handlers = createMemoHandlers({
    getRepository: () => (repository ? repository(repo) : repo),
    now: () => now,
    logError: (channel, error) => logged.push({ channel, error })
  })
  return {
    t,
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

describe('memo IPC handlers', () => {
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
    it('create, update, list, togglePin and remove', () => {
      const { handlers } = s()

      const memo = data(handlers.create('# 제목\n본문'))
      expect(memo).toMatchObject({ body: '# 제목\n본문', pinned: false, taskId: null })

      expect(data(handlers.update(memo.id, '고친 본문'))).toMatchObject({ body: '고친 본문' })
      expect(data(handlers.togglePin(memo.id))).toMatchObject({ pinned: true })
      expect(data(handlers.list()).map((m) => m.id)).toEqual([memo.id])

      expect(data(handlers.remove(memo.id))).toBeNull()
      expect(data(handlers.list())).toEqual([])
    })

    it('list puts pinned memos first', () => {
      const { handlers, setNow } = s()
      setNow(NOON(1))
      const a = data(handlers.create('a'))
      setNow(NOON(2))
      const b = data(handlers.create('b'))
      data(handlers.togglePin(a.id))

      expect(data(handlers.list()).map((m) => m.id)).toEqual([a.id, b.id])
    })

    it('search finds by text', () => {
      const { handlers, setNow } = s()
      setNow(NOON(1))
      const shopping = data(handlers.create('장보기 우유'))
      setNow(NOON(2))
      data(handlers.create('회의 안건'))

      expect(data(handlers.search('우유')).map((m) => m.id)).toEqual([shopping.id])
      expect(data(handlers.search('')).length).toBe(2)
    })

    it('toTask makes a task from the first line using main\'s today, and links it', () => {
      const { handlers, t } = s()
      const memo = data(handlers.create('내일 오후 3시 치과 예약\n전화번호 확인'))

      const result = data(handlers.toTask(memo.id))

      expect(result.task).toMatchObject({ title: '치과 예약', date: '2026-03-11', time: '15:00', notes: '전화번호 확인' })
      expect(result.memo).toMatchObject({ id: memo.id, taskId: result.task.id })
      expect(t.repo.get(result.task.id)).toEqual(result.task)
    })

    it('toTask twice is an invalid_input on taskId', () => {
      const { handlers } = s()
      const memo = data(handlers.create('한 번만'))
      data(handlers.toTask(memo.id))

      invalid(handlers.toTask(memo.id), 'taskId')
    })
  })

  describe('invalid input', () => {
    it('rejects non-string and too long bodies', () => {
      const { handlers, t } = s()

      invalid(handlers.create(5), 'body')
      invalid(handlers.create(null), 'body')
      invalid(handlers.create('x'.repeat(MAX_MEMO_LENGTH + 1)), 'body')
      invalid(handlers.create('   '), 'body')
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM memos').get()).toEqual({ n: 0 })
    })

    it('rejects bad ids, bodies and queries', () => {
      const { handlers } = s()
      const memo = data(handlers.create('본문'))

      invalid(handlers.update('nope', '내용'), 'id')
      invalid(handlers.update(memo.id, ''), 'body')
      invalid(handlers.update(memo.id, 7), 'body')
      invalid(handlers.remove(1), 'id')
      invalid(handlers.togglePin('x'), 'id')
      invalid(handlers.toTask('x'), 'id')
      invalid(handlers.search(3), 'query')
      invalid(handlers.search('x'.repeat(MAX_SEARCH_LENGTH + 1)), 'query')
    })

    it('never puts the user input in the response', () => {
      const { handlers } = s()
      const secret = 'SECRET-MEMO-TEXT'

      const results = [handlers.create(secret.repeat(MAX_MEMO_LENGTH)), handlers.search(secret.repeat(100)), handlers.update(secret, secret)]

      for (const result of results) {
        expect(result.ok).toBe(false)
        expect(JSON.stringify(result)).not.toContain(secret)
      }
    })
  })

  it('not_found for unknown memos', () => {
    const { handlers } = s()
    const notFound = { ok: false, error: { code: 'not_found' } }

    expect(handlers.update(MISSING_ID, '내용')).toEqual(notFound)
    expect(handlers.remove(MISSING_ID)).toEqual(notFound)
    expect(handlers.togglePin(MISSING_ID)).toEqual(notFound)
    expect(handlers.toTask(MISSING_ID)).toEqual(notFound)
  })

  it('db_unavailable when there is no repository', () => {
    const { handlers } = s(() => null)
    const unavailable = { ok: false, error: { code: 'db_unavailable' } }

    expect(handlers.list()).toEqual(unavailable)
    expect(handlers.create('a')).toEqual(unavailable)
    expect(handlers.update(MISSING_ID, 'a')).toEqual(unavailable)
    expect(handlers.remove(MISSING_ID)).toEqual(unavailable)
    expect(handlers.togglePin(MISSING_ID)).toEqual(unavailable)
    expect(handlers.search('a')).toEqual(unavailable)
    expect(handlers.toTask(MISSING_ID)).toEqual(unavailable)
    invalid(handlers.create(null), 'body')
  })

  it('internal errors hide the original message and are logged', () => {
    const boom = new Error('SECRET db path')
    const { handlers, logged } = s(() => ({ list: () => { throw boom } }) as unknown as MemoRepository)

    const result = handlers.list()

    expect(result).toEqual({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(logged).toEqual([{ channel: IPC.memosList, error: boom }])
  })

  it('a real database failure is internal too', () => {
    const { handlers, t, logged } = s()
    t.db.close()

    expect(handlers.create('x')).toEqual({ ok: false, error: { code: 'internal' } })
    expect(logged).toHaveLength(1)
  })

  it('registerMemoHandlers wires every memos channel', () => {
    const { handlers } = s()
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }

    registerMemoHandlers(ipc, handlers)

    const channels = Object.values(IPC).filter((channel) => channel.startsWith('memos:'))
    expect([...registered.keys()].sort()).toEqual([...channels].sort())

    const call = (channel: string, ...args: unknown[]): unknown => registered.get(channel)?.({ sender: 'x' }, ...args)
    const created = data(call(IPC.memosCreate, '내일 회의') as IpcResult<{ id: string }>)
    expect(call(IPC.memosUpdate, created.id, '내일 회의 준비')).toMatchObject({ ok: true, data: { body: '내일 회의 준비' } })
    expect(call(IPC.memosTogglePin, created.id)).toMatchObject({ ok: true, data: { pinned: true } })
    expect(call(IPC.memosSearch, '준비')).toMatchObject({ ok: true, data: [{ id: created.id }] })
    expect(call(IPC.memosToTask, created.id)).toMatchObject({ ok: true, data: { task: { date: '2026-03-11' } } })
    expect(call(IPC.memosList)).toMatchObject({ ok: true, data: [{ id: created.id }] })
    expect(call(IPC.memosRemove, created.id)).toEqual({ ok: true, data: null })
  })
})

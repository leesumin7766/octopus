import { afterEach, describe, expect, it } from 'vitest'
import {
  createTaskHandlers,
  registerTaskHandlers,
  type IpcMainLike,
  type TaskHandlers
} from '../../src/main/ipc/tasks'
import type { TaskRepository } from '../../src/main/core/tasks/taskRepository'
import { IPC, type IpcResult } from '../../src/shared/ipc'
import { MAX_IDS, MAX_TEXT_LENGTH } from '../../src/shared/validation/taskIpc'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

// 로컬 시각 2026-03-10(화) 정오. 어느 시간대에서도 로컬 날짜가 같다.
const NOON = (day: number): Date => new Date(2026, 2, day, 12, 0, 0)
const MISSING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' // 형식은 맞지만 없는 id

interface Setup {
  t: TestRepo
  handlers: TaskHandlers
  logged: { channel: string; error: unknown }[]
  /** main 의 "지금"을 옮긴다(저장소 시계도 함께). */
  setNow(date: Date): void
}

function setup(repository?: () => TaskRepository | null): Setup {
  const t = createTestRepo(NOON(10).toISOString())
  const logged: Setup['logged'] = []
  let now = NOON(10)

  const handlers = createTaskHandlers({
    getRepository: repository ?? (() => t.repo),
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

describe('task IPC handlers', () => {
  let current: Setup | undefined

  function s(repository?: () => TaskRepository | null): Setup {
    current = setup(repository)
    return current
  }

  afterEach(() => {
    try {
      current?.t.db.close()
    } catch {
      // 테스트가 이미 닫은 DB
    }
    current = undefined
  })

  describe('normal calls', () => {
    it('list returns each view', () => {
      const { t, handlers } = s()
      t.repo.create({ title: 'inbox' })
      t.repo.create({ title: 'overdue', date: '2026-03-09' })
      t.repo.create({ title: 'today', date: '2026-03-10' })
      t.repo.create({ title: 'upcoming', date: '2026-03-12' })
      t.repo.create({ title: 'someday', bucket: 'someday' })
      const finished = t.repo.create({ title: 'finished' })
      t.repo.setStatus(finished.id, 'done')

      const titles = (r: IpcResult<unknown>): string[] => (data(r) as { title: string }[]).map((x) => x.title)
      expect(titles(handlers.list('inbox'))).toEqual(['inbox'])
      expect(titles(handlers.list('upcoming'))).toEqual(['upcoming'])
      expect(titles(handlers.list('someday'))).toEqual(['someday'])
      expect(titles(handlers.list('done'))).toEqual(['finished'])

      const today = data(handlers.list('today')) as { overdue: { title: string }[]; today: { title: string }[] }
      expect(today.overdue.map((x) => x.title)).toEqual(['overdue'])
      expect(today.today.map((x) => x.title)).toEqual(['today'])
    })

    it('list("today") uses the date main computes, not one from the renderer', () => {
      const { t, handlers, setNow } = s()
      t.repo.create({ title: 'a', date: '2026-03-09' })
      t.repo.create({ title: 'b', date: '2026-03-10' })
      t.repo.create({ title: 'c', date: '2026-03-11' })

      type Today = { overdue: { title: string }[]; today: { title: string }[] }
      const first = data(handlers.list('today')) as Today
      expect([first.overdue.map((x) => x.title), first.today.map((x) => x.title)]).toEqual([['a'], ['b']])

      setNow(NOON(11))
      const next = data(handlers.list('today')) as Today
      expect([next.overdue.map((x) => x.title), next.today.map((x) => x.title)]).toEqual([['a', 'b'], ['c']])
    })

    it('quickAdd saves what the parser returns', () => {
      const { t, handlers } = s()

      const task = data(handlers.quickAdd('내일 오후 3시 보고서 #업무 !높음'))

      expect(task).toMatchObject({
        title: '보고서',
        date: '2026-03-11',
        time: '15:00',
        project: '업무',
        priority: 3,
        bucket: 'scheduled',
        repeat: null,
        status: 'open'
      })
      expect(t.repo.get(task.id)).toEqual(task)
    })

    it('quickAdd saves a repeating task with its first date', () => {
      const { handlers } = s()

      expect(data(handlers.quickAdd('매주 월 회의'))).toMatchObject({
        title: '회의',
        date: '2026-03-16',
        repeat: { freq: 'weekly', interval: 1, byWeekday: [1] }
      })
    })

    it('quickAdd without a date goes to the inbox', () => {
      const { handlers } = s()

      expect(data(handlers.quickAdd('우유 사기'))).toMatchObject({ title: '우유 사기', bucket: 'inbox', date: null })
    })

    it('quickAdd / parsePreview use defaultDate and defaultTime; bad options are invalid_input', () => {
      const { handlers } = s()
      const added = data(handlers.quickAdd('회의', { defaultDate: '2026-03-20', defaultTime: '10:00' }))
      expect(added).toMatchObject({ title: '회의', date: '2026-03-20', time: '10:00', bucket: 'scheduled' })
      expect(data(handlers.parsePreview('3시 회의', { defaultDate: '2026-03-20', defaultTime: '10:00' }))).toMatchObject({ date: '2026-03-20', time: '15:00', dateFrom: 'default' })

      for (const bad of [{ defaultDate: '2026-13-01' }, { defaultTime: '9:00' }, { extra: 1 }, 'x']) {
        expect(handlers.quickAdd('회의', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
        expect(handlers.parsePreview('회의', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      }
    })

    it('parsePreview returns the parse result without saving anything', () => {
      const { t, handlers } = s()

      expect(data(handlers.parsePreview('모레 회의 !낮음'))).toEqual({
        title: '회의',
        date: '2026-03-12',
        time: null,
        project: null,
        priority: 1,
        repeat: null,
        bucket: 'scheduled',
        dateFrom: 'text'
      })
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 })
    })

    it('create, update, setStatus and remove', () => {
      const { t, handlers } = s()

      const created = data(handlers.create({ title: '  새 일  ', priority: 1 }))
      expect(created).toMatchObject({ title: '새 일', priority: 1, bucket: 'inbox' })

      const updated = data(handlers.update(created.id, { notes: '메모', bucket: 'scheduled', date: '2026-03-20' }))
      expect(updated).toMatchObject({ notes: '메모', date: '2026-03-20' })

      expect(data(handlers.setStatus(created.id, 'done'))).toMatchObject({ status: 'done' })
      expect(t.repo.get(created.id)?.status).toBe('done')

      expect(data(handlers.remove(created.id))).toBeNull()
      expect(t.repo.get(created.id)).toBeUndefined()
    })

    it('reorder changes the order', () => {
      const { t, handlers } = s()
      const a = t.repo.create({ title: 'a' })
      const b = t.repo.create({ title: 'b' })

      expect(data(handlers.reorder([b.id, a.id]))).toBeNull()

      expect(t.repo.listView('inbox', '2026-03-10').map((x) => x.title)).toEqual(['b', 'a'])
    })

    it('moveToToday uses the date main computes', () => {
      const { t, handlers } = s()
      const task = t.repo.create({ title: 'a', date: '2026-03-01' })

      expect(data(handlers.moveToToday([task.id]))).toMatchObject([{ id: task.id, date: '2026-03-10' }])
    })

    it('moveToSomeday and reschedule', () => {
      const { t, handlers } = s()
      const a = t.repo.create({ title: 'a', date: '2026-03-01' })
      const b = t.repo.create({ title: 'b', date: '2026-03-01' })

      expect(data(handlers.moveToSomeday([a.id]))).toMatchObject([{ bucket: 'someday', date: null }])
      expect(data(handlers.reschedule([b.id], '2026-03-25'))).toMatchObject([{ bucket: 'scheduled', date: '2026-03-25' }])
    })
  })

  describe('invalid input', () => {
    const noInput = 'SECRET-USER-TEXT'

    function invalid(result: IpcResult<unknown>, ...fields: string[]): void {
      expect(result).toEqual({ ok: false, error: { code: 'invalid_input', fields } })
    }

    it('rejects an unknown view', () => {
      const { handlers } = s()
      invalid(handlers.list('weekly'), 'view')
      invalid(handlers.list(undefined), 'view')
    })

    it('rejects ids that are not ULIDs', () => {
      const { handlers } = s()
      invalid(handlers.update('not-a-ulid', { title: 'x' }), 'id')
      invalid(handlers.setStatus('1', 'done'), 'id')
      invalid(handlers.remove(123), 'id')
      invalid(handlers.reorder(['bad']), 'ids')
      invalid(handlers.moveToToday('x'), 'ids')
      invalid(handlers.moveToSomeday([MISSING_ID, 'bad']), 'ids')
      invalid(handlers.reschedule(['bad'], '2026-03-20'), 'ids')
    })

    it('rejects too many ids', () => {
      const { handlers } = s()
      const tooMany = Array.from({ length: MAX_IDS + 1 }, () => MISSING_ID)
      invalid(handlers.moveToToday(tooMany), 'ids')
      invalid(handlers.reorder(tooMany), 'ids')
    })

    it('rejects text that is too long or not a string', () => {
      const { t, handlers } = s()
      invalid(handlers.quickAdd('x'.repeat(MAX_TEXT_LENGTH + 1)), 'text')
      invalid(handlers.quickAdd(42), 'text')
      invalid(handlers.parsePreview('x'.repeat(MAX_TEXT_LENGTH + 1)), 'text')
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 })
    })

    it('rejects patch and input fields it does not know', () => {
      const { t, handlers } = s()
      const task = t.repo.create({ title: 'a' })

      invalid(handlers.update(task.id, { unknownField: 1 }), 'patch')
      invalid(handlers.update(task.id, { status: 'done' }), 'patch')
      invalid(handlers.update(task.id, 'title'), 'patch')
      invalid(handlers.create({ title: 'x', hack: 1 }), 'input')
      invalid(handlers.create(null), 'input')
      invalid(handlers.create({}), 'title')
      expect(t.repo.get(task.id)).toEqual(task)
    })

    it('rejects an unknown status', () => {
      const { t, handlers } = s()
      const task = t.repo.create({ title: 'a' })

      invalid(handlers.setStatus(task.id, 'archived'), 'status')
    })

    it('reports which field the repository found wrong', () => {
      const { t, handlers } = s()
      const task = t.repo.create({ title: 'a' })

      invalid(handlers.create({ title: '   ' }), 'title')
      invalid(handlers.create({ title: 'x', time: '25:00' }), 'time')
      invalid(handlers.create({ title: 'x', priority: 9 }), 'priority')
      invalid(handlers.update(task.id, { bucket: 'scheduled' }), 'date')
      invalid(handlers.reschedule([task.id], '2026-02-30'), 'date')
      invalid(handlers.reschedule([task.id], 5), 'date')
      invalid(handlers.quickAdd('   '), 'title')
      invalid(handlers.reorder([task.id, task.id]), 'ids')
    })

    it('never puts the user input in the response', () => {
      const { t, handlers } = s()
      const task = t.repo.create({ title: 'a' })

      const results = [
        handlers.update(task.id, { title: noInput, priority: 9 }),
        handlers.create({ title: noInput, time: noInput }),
        handlers.update(task.id, { [noInput]: 1 }),
        handlers.quickAdd(noInput.repeat(100)),
        handlers.reschedule([task.id], noInput)
      ]

      for (const result of results) {
        expect(result.ok).toBe(false)
        expect(JSON.stringify(result)).not.toContain(noInput)
      }
    })
  })

  describe('routine hook', () => {
    it('list("today") ensures today\'s routine items first, using the date main computes; other views do not', () => {
      const calls: string[] = []
      const t = createTestRepo(NOON(10).toISOString())
      const handlers = createTaskHandlers({
        getRepository: () => t.repo,
        now: () => NOON(10),
        logError: () => {},
        ensureRoutineTasks: (today) => void calls.push(today)
      })

      handlers.list('inbox')
      handlers.list('upcoming')
      expect(calls).toEqual([])

      handlers.list('today')
      expect(calls).toEqual(['2026-03-10'])
      t.db.close()
    })

    it('works without the hook', () => {
      const { handlers } = s()

      expect(handlers.list('today').ok).toBe(true)
    })
  })

  describe('not_found', () => {
    const notFound = { ok: false, error: { code: 'not_found' } }

    it('is returned for an id that does not exist', () => {
      const { handlers } = s()

      expect(handlers.update(MISSING_ID, { title: 'x' })).toEqual(notFound)
      expect(handlers.setStatus(MISSING_ID, 'done')).toEqual(notFound)
      expect(handlers.remove(MISSING_ID)).toEqual(notFound)
      expect(handlers.reorder([MISSING_ID, MISSING_ID.replace('A', 'B')])).toEqual(notFound)
      expect(handlers.moveToToday([MISSING_ID])).toEqual(notFound)
      expect(handlers.moveToSomeday([MISSING_ID])).toEqual(notFound)
      expect(handlers.reschedule([MISSING_ID], '2026-03-20')).toEqual(notFound)
    })

    it('a batch with one missing id changes nothing', () => {
      const { t, handlers } = s()
      const task = t.repo.create({ title: 'a', date: '2026-03-01' })

      expect(handlers.moveToToday([task.id, MISSING_ID])).toEqual(notFound)

      expect(t.repo.get(task.id)).toEqual(task)
    })
  })

  describe('db_unavailable', () => {
    it('is returned by every call that needs the database', () => {
      const { handlers } = s(() => null)
      const unavailable = { ok: false, error: { code: 'db_unavailable' } }

      expect(handlers.list('inbox')).toEqual(unavailable)
      expect(handlers.quickAdd('할 일')).toEqual(unavailable)
      expect(handlers.create({ title: 'x' })).toEqual(unavailable)
      expect(handlers.update(MISSING_ID, { title: 'x' })).toEqual(unavailable)
      expect(handlers.setStatus(MISSING_ID, 'done')).toEqual(unavailable)
      expect(handlers.remove(MISSING_ID)).toEqual(unavailable)
      expect(handlers.reorder([MISSING_ID])).toEqual(unavailable)
      expect(handlers.moveToToday([MISSING_ID])).toEqual(unavailable)
      expect(handlers.moveToSomeday([MISSING_ID])).toEqual(unavailable)
      expect(handlers.reschedule([MISSING_ID], '2026-03-20')).toEqual(unavailable)
    })

    it('parsePreview does not need the database', () => {
      const { handlers } = s(() => null)

      expect(data(handlers.parsePreview('내일 회의'))).toMatchObject({ title: '회의', date: '2026-03-11' })
    })

    it('invalid input is still reported as invalid input', () => {
      const { handlers } = s(() => null)

      expect(handlers.list('weekly')).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['view'] } })
    })
  })

  describe('internal errors', () => {
    it('hides the original message and logs it', () => {
      const secret = new Error('SECRET path C:\\Users\\someone\\octopus.db')
      const broken = {
        listView() {
          throw secret
        }
      } as unknown as TaskRepository
      const { handlers, logged } = s(() => broken)

      const result = handlers.list('inbox')

      expect(result).toEqual({ ok: false, error: { code: 'internal' } })
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(logged).toEqual([{ channel: IPC.tasksList, error: secret }])
    })

    it('a real database failure is internal too', () => {
      const { t, handlers, logged } = s()
      t.db.close()

      const result = handlers.create({ title: 'x' })

      expect(result).toEqual({ ok: false, error: { code: 'internal' } })
      expect(logged).toHaveLength(1)
      expect(logged[0].channel).toBe(IPC.tasksCreate)
    })

    it('validation and not-found errors are not logged as internal', () => {
      const { handlers, logged } = s()

      handlers.create({ title: '' })
      handlers.remove(MISSING_ID)

      expect(logged).toEqual([])
    })
  })
})

describe('registerTaskHandlers', () => {
  it('registers every task channel and forwards the arguments in order', () => {
    const { t, handlers } = setup()
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }

    registerTaskHandlers(ipc, handlers)

    const taskChannels = Object.values(IPC).filter((channel) => channel.startsWith('tasks:'))
    expect([...registered.keys()].sort()).toEqual([...taskChannels].sort())

    const call = (channel: string, ...args: unknown[]): unknown => registered.get(channel)?.({ sender: 'x' }, ...args)

    const created = data(call(IPC.tasksCreate, { title: 'a' }) as IpcResult<{ id: string }>)
    expect(call(IPC.tasksUpdate, created.id, { notes: '메모' })).toMatchObject({ ok: true, data: { notes: '메모' } })
    expect(call(IPC.tasksSetStatus, created.id, 'done')).toMatchObject({ ok: true, data: { status: 'done' } })
    expect(call(IPC.tasksReschedule, [created.id], '2026-03-25')).toMatchObject({ ok: true, data: [{ date: '2026-03-25' }] })
    expect(call(IPC.tasksList, 'done')).toMatchObject({ ok: true, data: [{ id: created.id }] })
    expect(call(IPC.tasksQuickAdd, '내일 회의')).toMatchObject({ ok: true, data: { date: '2026-03-11' } })
    expect(call(IPC.tasksParsePreview, '내일 회의')).toMatchObject({ ok: true, data: { date: '2026-03-11' } })
    expect(call(IPC.tasksRemove, created.id)).toEqual({ ok: true, data: null })
    t.db.close()
  })
})

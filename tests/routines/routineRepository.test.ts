import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RoutineNotFoundError } from '../../src/main/core/routines/routineRepository'
import { TaskValidationError } from '../../src/shared/validation/task'
import { RoutineValidationError } from '../../src/shared/validation/routine'
import { createRoutineEnv, localNoon, type RoutineEnv } from './helpers'

const TODAY = '2026-03-10' // 화요일
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]

describe('routine repository', () => {
  let env: RoutineEnv

  beforeEach(() => {
    env = createRoutineEnv()
  })

  afterEach(() => {
    env.t.db.close()
  })

  function routineTasks(routineId?: string) {
    const rows = env.t.db
      .prepare('SELECT id, routine_id AS routineId, date, status, title FROM tasks WHERE routine_id IS NOT NULL ORDER BY date, id')
      .all() as { id: string; routineId: string; date: string; status: string; title: string }[]
    return routineId ? rows.filter((row) => row.routineId === routineId) : rows
  }

  describe('create', () => {
    it('trims the title, sorts and dedupes the days, and defaults to active', () => {
      const routine = env.routines.create({ title: '  스트레칭  ', days: [3, 1, 3, 5] }, TODAY)

      expect(routine).toMatchObject({ title: '스트레칭', days: [1, 3, 5], active: true, order: 1 })
      expect(routine.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(env.routines.get(routine.id)).toEqual(routine)
    })

    it('gives increasing order values', () => {
      const a = env.routines.create({ title: 'a', days: EVERY_DAY }, TODAY)
      const b = env.routines.create({ title: 'b', days: EVERY_DAY }, TODAY)

      expect(b.order).toBeGreaterThan(a.order)
      expect(env.routines.list().map((r) => r.title)).toEqual(['a', 'b'])
    })

    it('rejects wrong input and stores nothing', () => {
      const bad = (input: Record<string, unknown>) => () => env.routines.create(input as never, TODAY)

      expect(bad({ title: '  ', days: EVERY_DAY })).toThrow(RoutineValidationError)
      expect(bad({ title: 'a', days: [] })).toThrow(RoutineValidationError)
      expect(bad({ title: 'a', days: [7] })).toThrow(RoutineValidationError)
      expect(bad({ title: 'a', days: [1.5] })).toThrow(RoutineValidationError)
      expect(bad({ title: 'a', days: '1' })).toThrow(RoutineValidationError)
      expect(bad({ title: 'a', days: [1], active: 'yes' })).toThrow(RoutineValidationError)
      expect(bad({ title: 'x'.repeat(201), days: [1] })).toThrow(RoutineValidationError)
      expect(env.routines.list()).toEqual([])
    })

    it('reports which fields are wrong', () => {
      try {
        env.routines.create({ title: '', days: [] }, TODAY)
        expect.unreachable()
      } catch (error) {
        expect((error as RoutineValidationError).issues.map((i) => i.field)).toEqual(['title', 'days'])
      }
    })

    it('makes today\'s task right away when the routine is due today', () => {
      const routine = env.routines.create({ title: '스트레칭', days: EVERY_DAY }, TODAY)

      const [task] = env.routines.todayItems(TODAY)
      expect(task).toMatchObject({
        title: '스트레칭',
        bucket: 'scheduled',
        date: TODAY,
        routineId: routine.id,
        repeat: null,
        status: 'open'
      })
    })

    it('makes no task when it is not due today', () => {
      env.routines.create({ title: '월요일 루틴', days: [1] }, TODAY)

      expect(routineTasks()).toEqual([])
    })

    it('rejects a malformed today', () => {
      expect(() => env.routines.create({ title: 'a', days: [1] }, '2026-02-30')).toThrow(RoutineValidationError)
    })
  })

  describe('ensureTodayTasks', () => {
    it('is idempotent: calling twice leaves one task', () => {
      env.routines.create({ title: '스트레칭', days: EVERY_DAY }, TODAY)

      expect(env.routines.ensureTodayTasks(TODAY)).toBe(0) // create 가 이미 만듦
      expect(env.routines.ensureTodayTasks(TODAY)).toBe(0)
      expect(routineTasks()).toHaveLength(1)
    })

    it('creates one task per due routine, and only once', () => {
      env.setNow(localNoon(2026, 3, 9))
      env.routines.create({ title: 'a', days: [0] }, '2026-03-08')
      env.routines.create({ title: 'b', days: EVERY_DAY }, '2026-03-08')
      env.routines.create({ title: 'c', days: WEEKDAYS }, '2026-03-08')

      expect(env.routines.ensureTodayTasks(TODAY)).toBe(2) // 화요일: b, c
      expect(env.routines.ensureTodayTasks(TODAY)).toBe(0)

      expect(routineTasks().filter((row) => row.date === TODAY).map((row) => row.title).sort()).toEqual(['b', 'c'])
    })

    it('follows the weekday: Tuesday is not Sunday-only', () => {
      env.routines.create({ title: '일요일만', days: [0] }, TODAY)

      expect(env.routines.ensureTodayTasks(TODAY)).toBe(0)
      expect(env.routines.ensureTodayTasks('2026-03-15')).toBe(1) // 일요일
      expect(routineTasks().map((row) => row.date)).toEqual(['2026-03-15'])
    })

    it('skips inactive routines', () => {
      env.routines.create({ title: '꺼진 루틴', days: EVERY_DAY, active: false }, TODAY)

      expect(env.routines.ensureTodayTasks(TODAY)).toBe(0)
      expect(routineTasks()).toEqual([])
    })

    it('makes a new task for a new day and keeps the old one', () => {
      env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)

      expect(env.routines.ensureTodayTasks('2026-03-11')).toBe(1)

      expect(routineTasks().map((row) => row.date)).toEqual([TODAY, '2026-03-11'])
    })

    it('does not make another task when today\'s one is already done', () => {
      env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const [task] = env.routines.todayItems(TODAY)
      env.t.repo.setStatus(task.id, 'done')

      expect(env.routines.ensureTodayTasks(TODAY)).toBe(0)
      expect(routineTasks()).toHaveLength(1)
    })

    it('the unique index refuses a second task for the same routine and date', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const insert = () =>
        env.t.db
          .prepare(
            `INSERT INTO tasks (id, title, status, bucket, date, routine_id, sort_order, created_at, updated_at)
             VALUES ('01DUP', 'dup', 'open', 'scheduled', ?, ?, 99, 'x', 'x')`
          )
          .run(TODAY, routine.id)

      expect(insert).toThrow(/UNIQUE/)
    })

    it('the unique index ignores tasks without a routine', () => {
      env.t.repo.create({ title: 'a', date: TODAY })
      env.t.repo.create({ title: 'b', date: TODAY })

      expect(env.t.repo.listView('today', TODAY).today).toHaveLength(2)
    })

    it('rejects a malformed today', () => {
      expect(() => env.routines.ensureTodayTasks('내일')).toThrow(RoutineValidationError)
    })
  })

  describe('routine tasks in the task views', () => {
    it('a past unfinished routine task is not in the overdue list, but an ordinary one is', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, '2026-03-08')
      env.routines.ensureTodayTasks('2026-03-09')
      env.t.repo.create({ title: '밀린 일반 할 일', date: '2026-03-08' })

      const view = env.t.repo.listView('today', TODAY)

      expect(view.overdue.map((task) => task.title)).toEqual(['밀린 일반 할 일'])
      expect(view.overdue.some((task) => task.routineId === routine.id)).toBe(false)
    })

    it('today\'s routine task shows up in the today list', () => {
      env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)

      expect(env.t.repo.listView('today', TODAY).today.map((task) => task.title)).toEqual(['매일'])
    })

    it('a finished routine task is a record for the checklist history, not an entry in the done view', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, '2026-03-09')
      const [past] = env.routines.todayItems('2026-03-09')
      env.t.repo.setStatus(past.id, 'done')
      const ordinary = env.t.repo.create({ title: '일반 할 일', date: TODAY })
      env.t.repo.setStatus(ordinary.id, 'done')

      expect(env.t.repo.listView('done', TODAY).map((task) => task.title)).toEqual(['일반 할 일'])
      expect(env.t.repo.get(past.id)?.status).toBe('done') // 기록은 그대로 남아 있고
      expect(env.routines.history(TODAY).routines[0]).toMatchObject({ id: routine.id }) // 기록 격자에 쓰인다
      expect(env.routines.history(TODAY).routines[0].cells).toContain('done')
    })

    it('a routine task cannot be moved out of "scheduled"', () => {
      env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const [task] = env.routines.todayItems(TODAY)

      expect(() => env.t.repo.update(task.id, { bucket: 'someday', date: null })).toThrow(TaskValidationError)
      expect(() => env.t.repo.moveToSomeday([task.id])).toThrow(TaskValidationError)
      expect(env.t.repo.get(task.id)).toEqual(task)
    })
  })

  describe('update', () => {
    it('turning a routine off removes today\'s open task but keeps done and past ones', () => {
      env.setNow(localNoon(2026, 3, 9))
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, '2026-03-09')
      env.setNow(localNoon(2026, 3, 10))
      env.routines.ensureTodayTasks(TODAY)
      const [yesterdayTask] = env.routines.todayItems('2026-03-09')

      const off = env.routines.update(routine.id, { active: false }, TODAY)

      expect(off.active).toBe(false)
      expect(routineTasks(routine.id).map((row) => row.date)).toEqual(['2026-03-09'])
      expect(env.t.repo.get(yesterdayTask.id)).toBeDefined()
    })

    it('turning it off keeps today\'s task when it is already done', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const [task] = env.routines.todayItems(TODAY)
      env.t.repo.setStatus(task.id, 'done')

      env.routines.update(routine.id, { active: false }, TODAY)

      expect(env.t.repo.get(task.id)?.status).toBe('done')
    })

    it('turning it back on makes today\'s task again', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY, active: false }, TODAY)
      expect(routineTasks()).toEqual([])

      env.routines.update(routine.id, { active: true }, TODAY)

      expect(routineTasks().map((row) => row.date)).toEqual([TODAY])
    })

    it('a new title reaches today\'s open task, not done or past ones', () => {
      env.setNow(localNoon(2026, 3, 9))
      const routine = env.routines.create({ title: '옛 이름', days: EVERY_DAY }, '2026-03-09')
      env.setNow(localNoon(2026, 3, 10))
      env.routines.ensureTodayTasks(TODAY)

      env.routines.update(routine.id, { title: '새 이름' }, TODAY)

      expect(routineTasks(routine.id).map((row) => [row.date, row.title])).toEqual([
        ['2026-03-09', '옛 이름'],
        [TODAY, '새 이름']
      ])
    })

    it('changing the days so that today is no longer included removes today\'s open task', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)

      env.routines.update(routine.id, { days: [0, 6] }, TODAY) // 주말만

      expect(routineTasks()).toEqual([])
    })

    it('changing the days so that today is included makes the task', () => {
      const routine = env.routines.create({ title: '월요일', days: [1] }, TODAY)
      expect(routineTasks()).toEqual([])

      env.routines.update(routine.id, { days: [1, 2] }, TODAY)

      expect(routineTasks().map((row) => row.date)).toEqual([TODAY])
    })

    it('validates the merged values and throws for an unknown id', () => {
      const routine = env.routines.create({ title: 'a', days: [1] }, TODAY)

      expect(() => env.routines.update(routine.id, { title: ' ' }, TODAY)).toThrow(RoutineValidationError)
      expect(() => env.routines.update(routine.id, { days: [] }, TODAY)).toThrow(RoutineValidationError)
      expect(() => env.routines.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { title: 'x' }, TODAY)).toThrow(RoutineNotFoundError)
      expect(env.routines.get(routine.id)).toEqual(routine)
    })

    it('refreshes updatedAt', () => {
      const routine = env.routines.create({ title: 'a', days: [1] }, TODAY)
      env.setNow(localNoon(2026, 3, 11))

      expect(env.routines.update(routine.id, { title: 'b' }, TODAY).updatedAt).toBe(localNoon(2026, 3, 11))
    })
  })

  describe('remove', () => {
    it('keeps past records (done or not) and removes only open tasks from today on', () => {
      env.setNow(localNoon(2026, 3, 8))
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, '2026-03-08')
      const [doneDay] = env.routines.todayItems('2026-03-08')
      env.t.repo.setStatus(doneDay.id, 'done')
      env.routines.ensureTodayTasks('2026-03-09') // 지난 미완료 기록
      env.routines.ensureTodayTasks(TODAY) // 오늘 미완료
      env.routines.ensureTodayTasks('2026-03-11') // 내일 미완료

      expect(env.routines.remove(routine.id, TODAY)).toBe(true)

      expect(env.routines.get(routine.id)).toBeUndefined()
      expect(routineTasks().map((row) => [row.date, row.status])).toEqual([
        ['2026-03-08', 'done'],
        ['2026-03-09', 'open']
      ])
    })

    it('keeps today\'s task when it is already done', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const [task] = env.routines.todayItems(TODAY)
      env.t.repo.setStatus(task.id, 'done')

      env.routines.remove(routine.id, TODAY)

      expect(env.t.repo.get(task.id)?.status).toBe('done')
    })

    it('returns false for an unknown routine and leaves everything alone', () => {
      env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)

      expect(env.routines.remove('01ARZ3NDEKTSV4RRFFQ69G5FAV', TODAY)).toBe(false)
      expect(routineTasks()).toHaveLength(1)
    })

    it('does not touch ordinary tasks', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const ordinary = env.t.repo.create({ title: '일반', date: TODAY })

      env.routines.remove(routine.id, TODAY)

      expect(env.t.repo.get(ordinary.id)).toBeDefined()
    })
  })

  describe('todayItems', () => {
    it('lists today\'s routine tasks including done ones, but not canceled or ordinary ones', () => {
      env.routines.create({ title: 'a', days: EVERY_DAY }, TODAY)
      env.routines.create({ title: 'b', days: EVERY_DAY }, TODAY)
      env.routines.create({ title: 'c', days: EVERY_DAY }, TODAY)
      env.t.repo.create({ title: '일반', date: TODAY })
      const [a, , c] = env.routines.todayItems(TODAY)
      env.t.repo.setStatus(a.id, 'done')
      env.t.repo.setStatus(c.id, 'canceled')

      expect(env.routines.todayItems(TODAY).map((task) => [task.title, task.status])).toEqual([
        ['a', 'done'],
        ['b', 'open']
      ])
    })
  })

  describe('history', () => {
    it('maps each routine and date to done / open / none', () => {
      env.setNow(localNoon(2026, 3, 7))
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, '2026-03-07')
      env.routines.ensureTodayTasks('2026-03-08')
      env.routines.ensureTodayTasks('2026-03-09')
      env.setNow(localNoon(2026, 3, 10))
      env.routines.ensureTodayTasks(TODAY)

      const status = (date: string, to: 'done' | 'canceled') => {
        const row = routineTasks(routine.id).find((r) => r.date === date)
        env.t.repo.setStatus(row!.id, to)
      }
      status('2026-03-07', 'done')
      status('2026-03-09', 'done')
      // 03-08 은 열린 채로(놓침), 오늘은 열린 채로(진행 중), 03-06 은 항목 없음

      const history = env.routines.history(TODAY)
      const cell = (date: string) => history.routines[0].cells[history.dates.indexOf(date)]

      expect(history.dates).toHaveLength(14)
      expect(history.dates[0]).toBe('2026-02-25')
      expect(history.dates[13]).toBe(TODAY)
      expect(history.routines[0]).toMatchObject({ id: routine.id, title: '매일', active: true })
      expect(cell('2026-03-06')).toBe('none')
      expect(cell('2026-03-07')).toBe('done')
      expect(cell('2026-03-08')).toBe('open')
      expect(cell('2026-03-09')).toBe('done')
      expect(cell(TODAY)).toBe('open')
    })

    it('a canceled task counts as none', () => {
      const routine = env.routines.create({ title: '매일', days: EVERY_DAY }, TODAY)
      const [task] = env.routines.todayItems(TODAY)
      env.t.repo.setStatus(task.id, 'canceled')

      expect(env.routines.history(TODAY, 3).routines[0]).toMatchObject({ id: routine.id, cells: ['none', 'none', 'none'] })
    })

    it('includes inactive routines and every routine, in order', () => {
      env.routines.create({ title: 'a', days: EVERY_DAY }, TODAY)
      env.routines.create({ title: 'b', days: EVERY_DAY, active: false }, TODAY)

      expect(env.routines.history(TODAY).routines.map((r) => [r.title, r.active])).toEqual([
        ['a', true],
        ['b', false]
      ])
    })

    it('has no routines when there are none', () => {
      expect(env.routines.history(TODAY)).toMatchObject({ routines: [] })
    })

    it('days controls the window and is validated', () => {
      expect(env.routines.history(TODAY, 1).dates).toEqual([TODAY])
      expect(env.routines.history(TODAY, 90).dates).toHaveLength(90)
      for (const days of [0, 91, 1.5, -3]) {
        expect(() => env.routines.history(TODAY, days)).toThrow(RoutineValidationError)
      }
    })

    it('crosses a year end', () => {
      expect(env.routines.history('2027-01-02', 4).dates).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    })
  })
})

import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoRepository, type MemoRepository } from '../../src/main/core/memos/memoRepository'
import { createShortcutRepository, type ShortcutRepository } from '../../src/main/core/shortcuts/shortcutRepository'
import { tmpdir } from 'node:os'
import { createRoutineRepository, type RoutineRepository } from '../../src/main/core/routines/routineRepository'
import { createSettingsRepository } from '../../src/main/core/settings/settingsRepository'
import { parseLayout } from '../../src/shared/home/layout'
import {
  CAPTURE_ENV,
  CAPTURE_VIEW_ENV,
  createSampleData,
  readCaptureConfig,
  SAMPLE_LAYOUT,
  SAMPLE_SHORTCUT_URLS,
  seedCaptureSettings,
  SAMPLE_MEMOS,
  SAMPLE_ROUTINES
} from '../../src/main/dev/captureSupport'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

describe('capture views', () => {
  it('can open the checklist and memo screens, besides the task views', () => {
    const view = (value: string) => readCaptureConfig({ [CAPTURE_ENV]: 'a.png', [CAPTURE_VIEW_ENV]: value }, false)?.view

    expect(view('home')).toBe('home')
    expect(view('home-arrange')).toBe('home-arrange')
    expect(view('home-pie')).toBe('home-pie')
    expect(view('home-day')).toBe('home-day')
    expect(view('settings')).toBe('settings')
    expect(view('routines')).toBe('routines')
    expect(view('memos')).toBe('memos')
    expect(view('inbox')).toBe('inbox')
    expect(view('nope')).toBe('today')
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'a.png' }, false)).toEqual({ outputPath: resolve('a.png'), view: 'today' })
  })

  it('is still off in a packaged app', () => {
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'a.png', [CAPTURE_VIEW_ENV]: 'memos' }, true)).toBeNull()
  })
})

describe('createSampleData', () => {
  let t: TestRepo
  let routines: RoutineRepository
  let memos: MemoRepository
  let shortcuts: ShortcutRepository

  beforeEach(() => {
    t = createTestRepo()
    const now = () => new Date(2026, 2, 10, 12, 0, 0)
    routines = createRoutineRepository(t.db, { now, tasks: t.repo })
    memos = createMemoRepository(t.db, { now, tasks: t.repo })
    shortcuts = createShortcutRepository(t.db, { now })
  })

  afterEach(() => {
    t.db.close()
  })

  const seed = (today: string): void => createSampleData({ tasks: t.repo, routines, memos, shortcuts }, today, tmpdir())

  // 2026-03-10 화, 03-14 토, 03-15 일: 평일 루틴은 주말에 오늘 항목이 없다.
  it.each(['2026-03-10', '2026-03-14', '2026-03-15'])('makes three routines, one done today (today = %s)', (today) => {
    seed(today)

    expect(routines.list().map((r) => r.title)).toEqual(SAMPLE_ROUTINES.map((r) => r.title))
    const items = routines.todayItems(today)
    const done = items.filter((task) => task.status === 'done')
    expect(done.map((task) => task.title)).toEqual(['아침 스트레칭'])
    expect(items.length).toBeGreaterThanOrEqual(2) // 매일 루틴 2개는 항상 있음
    expect(items.some((task) => task.status === 'open')).toBe(true)
  })

  it('leaves a few days of history with done and missed cells', () => {
    seed('2026-03-10')

    const history = routines.history('2026-03-10')
    const cells = history.routines.flatMap((row) => row.cells)
    expect(cells).toContain('done')
    expect(cells).toContain('missed') // 지난 날의 못 한 항목
    expect(cells).toContain('pending') // 오늘 진행 중
    expect(cells).toContain('none')
    // 첫 루틴(매일)은 오늘 포함 최근 7일에 모두 항목이 있다
    expect(history.routines[0].cells.slice(-7).every((cell) => cell !== 'none')).toBe(true)
  })

  it('the past routine records do not turn into overdue tasks, and the task samples are unchanged', () => {
    seed('2026-03-10')

    const view = t.repo.listView('today', '2026-03-10')
    expect(view.overdue).toHaveLength(2)
    expect(view.overdue.every((task) => task.routineId === null)).toBe(true)
    expect(t.repo.listView('inbox', '2026-03-10')).toHaveLength(1)
  })

  it('makes three memos: one pinned first, one linked to a task made from its first line', () => {
    seed('2026-03-10')

    const list = memos.list()
    expect(list).toHaveLength(SAMPLE_MEMOS.length)
    expect(list[0]).toMatchObject({ pinned: true })
    expect(list.filter((memo) => memo.pinned)).toHaveLength(1)

    const linked = list.filter((memo) => memo.taskId !== null)
    expect(linked).toHaveLength(1)
    expect(t.repo.get(linked[0].taskId as string)).toMatchObject({
      title: '치과 예약 전화하기',
      date: '2026-03-11',
      time: '15:00'
    })
  })

  it('makes three shortcuts for the home card: two links and one folder, in that order', () => {
    seed('2026-03-10')

    const list = shortcuts.list()
    expect(list.map((s) => [s.kind, s.pathType, s.label])).toEqual([
      ['url', null, 'MDN 문서'],
      ['url', null, '위키백과'],
      ['path', 'folder', '문서 폴더']
    ])
    expect(list[2].target).toBe(tmpdir())
    expect(SAMPLE_SHORTCUT_URLS.every((s) => s.url.startsWith('https://'))).toBe(true)
  })

  it('every sample passes the real validation (nothing throws on any weekday)', () => {
    for (let day = 8; day <= 14; day++) {
      const env = createTestRepo()
      const now = () => new Date(2026, 2, 10, 12, 0, 0)
      const r = createRoutineRepository(env.db, { now, tasks: env.repo })
      const m = createMemoRepository(env.db, { now, tasks: env.repo })
      const sc = createShortcutRepository(env.db, { now })

      expect(() =>
        createSampleData({ tasks: env.repo, routines: r, memos: m, shortcuts: sc }, `2026-03-${String(day).padStart(2, '0')}`, tmpdir())
      ).not.toThrow()
      env.db.close()
    }
  })
})

describe('capture settings', () => {
  it('the sample layout is a valid layout that differs from the default', () => {
    expect(parseLayout(SAMPLE_LAYOUT)).toEqual(SAMPLE_LAYOUT)
    expect(SAMPLE_LAYOUT.order).not.toEqual(['todo', 'calendar', 'memo', 'shortcuts'])
    expect(SAMPLE_LAYOUT.col).not.toBe(50)
    expect(SAMPLE_LAYOUT.row).not.toBe(50)
  })

  it('home-arrange saves the sample layout; the other screens leave the settings alone', () => {
    const t = createTestRepo()
    const settings = createSettingsRepository(t.db)

    seedCaptureSettings(settings, 'home')
    seedCaptureSettings(settings, 'memos')
    expect(settings.get('home.layout')).toMatchObject({ col: 50, row: 50 })

    seedCaptureSettings(settings, 'home-arrange')
    expect(settings.get('home.layout')).toEqual(SAMPLE_LAYOUT)
    t.db.close()
  })
})

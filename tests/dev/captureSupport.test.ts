import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildSampleTasks,
  CAPTURE_ENV,
  CAPTURE_VIEW_ENV,
  createSampleTasks,
  readCaptureConfig
} from '../../src/main/dev/captureSupport'
import { createTestRepo, type TestRepo } from '../tasks/helpers'

describe('readCaptureConfig', () => {
  it('is off without OCTOPUS_CAPTURE', () => {
    expect(readCaptureConfig({}, false)).toBeNull()
    expect(readCaptureConfig({ [CAPTURE_ENV]: '' }, false)).toBeNull()
  })

  it('is never on in a packaged app', () => {
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'out.png', [CAPTURE_VIEW_ENV]: 'inbox' }, true)).toBeNull()
  })

  it('only accepts a .png path, so it cannot overwrite other files', () => {
    expect(readCaptureConfig({ [CAPTURE_ENV]: '/home/user/octopus.db' }, false)).toBeNull()
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'notes.txt' }, false)).toBeNull()
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'shot.PNG' }, false)).not.toBeNull()
  })

  it('defaults to the today view and resolves the path', () => {
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'shots/a.png' }, false)).toEqual({
      outputPath: resolve('shots/a.png'),
      view: 'today'
    })
  })

  it('uses a valid view and falls back to today for an invalid one', () => {
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'a.png', [CAPTURE_VIEW_ENV]: 'inbox' }, false)?.view).toBe('inbox')
    expect(readCaptureConfig({ [CAPTURE_ENV]: 'a.png', [CAPTURE_VIEW_ENV]: 'nope' }, false)?.view).toBe('today')
  })
})

describe('sample tasks', () => {
  let t: TestRepo

  beforeEach(() => {
    t = createTestRepo()
  })

  afterEach(() => {
    t.db.close()
  })

  it.each(['2026-03-10', '2026-12-30', '2028-02-27'])('are all valid and land in the intended views (today = %s)', (today) => {
    createSampleTasks(t.repo, today)

    const view = t.repo.listView('today', today)
    expect(view.overdue).toHaveLength(2)
    // 오늘 3 + 오늘 날짜의 반복 1
    expect(view.today).toHaveLength(4)
    expect(view.today.filter((task) => task.repeat !== null)).toHaveLength(1)
    expect(t.repo.listView('upcoming', today)).toHaveLength(2)
    expect(t.repo.listView('inbox', today)).toHaveLength(1)
    expect(t.repo.listView('someday', today)).toHaveLength(0)
    expect(t.repo.listView('done', today)).toHaveLength(2) // 완료 보기 표본: 오늘 끝낸 것 두 개
  })

  it('shows off the row details: a past deadline, a time, a project, a priority and a repeat', () => {
    const tasks = buildSampleTasks('2026-03-10')

    expect(tasks.some((task) => typeof task.deadline === 'string' && task.deadline < '2026-03-10')).toBe(true)
    expect(tasks.some((task) => typeof task.time === 'string')).toBe(true)
    expect(tasks.some((task) => typeof task.project === 'string')).toBe(true)
    expect(tasks.some((task) => (task.priority ?? 0) > 0)).toBe(true)
    expect(tasks.some((task) => task.repeat != null)).toBe(true)
  })

  it('has no secrets or real user data, just plain sample titles', () => {
    for (const task of buildSampleTasks('2026-03-10')) expect(task.title.length).toBeGreaterThan(0)
  })
})

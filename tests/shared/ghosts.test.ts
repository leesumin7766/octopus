import { describe, expect, it } from 'vitest'
import { buildGhosts, countGhosts } from '../../src/shared/calendar/ghosts'
import { futureOccurrences } from '../../src/shared/tasks/repeat'
import type { RepeatRule, Task } from '../../src/shared/tasks/types'

// 2026-11-25 는 수요일. 11월 격자 범위 예: 11/01 ~ 12/12.
const TODAY = '2026-11-25'

function task(partial: Partial<Task>): Task {
  return {
    id: 'T1', title: '주간 회의', notes: '', status: 'open', bucket: 'scheduled', date: '2026-11-30', time: null, deadline: null,
    priority: 0, project: null, tags: [], repeat: { freq: 'weekly', interval: 1, byWeekday: [1], anchor: '2026-11-30' }, routineId: null,
    source: null, order: 0, createdAt: '', updatedAt: '', doneAt: null, ...partial
  } as Task
}

describe('futureOccurrences', () => {
  const weekly: RepeatRule = { freq: 'weekly', interval: 1, byWeekday: [1] }

  it('lists the occurrences after a date inside from..to (ends inclusive)', () => {
    expect(futureOccurrences(weekly, '2026-11-30', '2026-12-01', '2026-12-21')).toEqual(['2026-12-07', '2026-12-14', '2026-12-21'])
  })

  it('skips occurrences before from and stops at to', () => {
    expect(futureOccurrences(weekly, '2026-11-02', '2026-11-20', '2026-11-30')).toEqual(['2026-11-23', '2026-11-30'])
    expect(futureOccurrences(weekly, '2026-11-30', '2026-12-01', '2026-12-06')).toEqual([])
  })

  it('respects the interval and the anchor (every 2 weeks)', () => {
    const biweekly: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-11-30' }
    expect(futureOccurrences(biweekly, '2026-11-30', '2026-12-01', '2027-01-31')).toEqual(['2026-12-14', '2026-12-28', '2027-01-11', '2027-01-25'])
  })

  it('a repeat left undone for a long time still reaches the visible range (no silent cut-off)', () => {
    // 저장된 회차가 1년 전에 멈춘 매일 반복: 보이는 구간의 모든 날이 나온다
    const daily: RepeatRule = { freq: 'daily', interval: 1 }
    const dates = futureOccurrences(daily, '2025-11-26', '2026-11-26', '2026-12-02')
    expect(dates).toEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
    // 매주도 마찬가지
    expect(futureOccurrences(weekly, '2024-01-01', '2026-11-20', '2026-12-10')).toEqual(['2026-11-23', '2026-11-30', '2026-12-07'])
  })

  it('a long-overdue every-2-weeks repeat keeps its cycle from the anchor', () => {
    const biweekly: RepeatRule = { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2025-11-24' }
    // 기준일 11/24(2025) 부터 2주마다 월요일 → 2026-11-23 도 그 주기 위(52주)
    expect(futureOccurrences(biweekly, '2025-11-24', '2026-11-20', '2026-12-31')).toEqual(['2026-11-23', '2026-12-07', '2026-12-21'])
  })

  it('the step limit only bounds the walk inside the range', () => {
    expect(futureOccurrences({ freq: 'daily', interval: 1 }, '2026-01-01', '2026-11-01', '2026-12-12', 5)).toHaveLength(5)
  })
})

describe('buildGhosts', () => {
  const range = { from: '2026-11-01', to: '2026-12-12' }

  it('a weekly Monday repeat shows the later Mondays in the range, but not the stored one nor past days', () => {
    const ghosts = buildGhosts({ repeating: [task({})], routines: [], real: [], today: TODAY, ...range })
    expect(ghosts.map((g) => g.date)).toEqual(['2026-12-07'])
    expect(ghosts[0]).toMatchObject({ kind: 'repeat', openTaskId: 'T1', openDate: '2026-11-30', title: '주간 회의' })
  })

  it('an earlier stored occurrence (overdue or today) shows the Mondays after today only', () => {
    const ghosts = buildGhosts({ repeating: [task({ date: '2026-11-23' })], routines: [], real: [], today: TODAY, ...range })
    expect(ghosts.map((g) => g.date)).toEqual(['2026-11-30', '2026-12-07'])
  })

  it('ignores done tasks, tasks without a repeat, and checklist items', () => {
    const none = buildGhosts({
      repeating: [task({ status: 'done' }), task({ id: 'T2', repeat: null }), task({ id: 'T3', routineId: 'R9' })],
      routines: [], real: [], today: TODAY, ...range
    })
    expect(none).toEqual([])
  })

  it('checklist items appear on future days of their weekdays, and not where the real item already exists', () => {
    const routine = { id: 'R1', title: '아침 스트레칭', days: [1, 3], active: true }
    const ghosts = buildGhosts({ repeating: [], routines: [routine], real: [{ routineId: 'R1', date: '2026-12-02' }], today: TODAY, ...range })
    expect(ghosts.map((g) => g.date)).toEqual(['2026-11-30', '2026-12-07', '2026-12-09'])
    expect(ghosts.every((g) => g.kind === 'checklist' && g.openTaskId === null)).toBe(true)
  })

  it('inactive checklist items are skipped', () => {
    expect(buildGhosts({ repeating: [], routines: [{ id: 'R1', title: '꺼짐', days: [0, 1, 2, 3, 4, 5, 6], active: false }], real: [], today: TODAY, ...range })).toEqual([])
  })

  it('counts per date and sorts by date then time', () => {
    const ghosts = buildGhosts({
      repeating: [task({ time: '15:00' }), task({ id: 'T2', title: '아침 점검', time: '09:00' })],
      routines: [], real: [], today: TODAY, ...range
    })
    expect(ghosts.map((g) => g.title)).toEqual(['아침 점검', '주간 회의'])
    expect(countGhosts(ghosts).get('2026-12-07')).toBe(2)
  })

  it('refuses an absurdly long range (cost guard)', () => {
    expect(buildGhosts({ repeating: [task({})], routines: [], real: [], today: TODAY, from: '2026-01-01', to: '2026-12-31' })).toEqual([])
  })
})

// C3 독립 검증(Opus): 미래 반복 '예정(반복)' 계산(순수 함수). 저장된 회차와 겹치지 않고, 오래 밀린 반복도 보이는 달에 나타난다.
import { describe, expect, it } from 'vitest'
import { buildGhosts } from '../../src/shared/calendar/ghosts'
import type { RepeatRule, Task } from '../../src/shared/tasks/types'

const TODAY = '2026-11-26' // 목
const FROM = '2026-11-01'
const TO = '2026-12-12'

function task(id: string, date: string, repeat: RepeatRule | null, extra: Partial<Task> = {}): Task {
  return {
    id, title: id, notes: '', status: 'open', bucket: 'scheduled', date, time: null, deadline: null, priority: 0,
    project: null, tags: [], repeat, routineId: null, source: null, order: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', doneAt: null, ...extra
  }
}

const datesOf = (ghosts: ReturnType<typeof buildGhosts>, id: string): string[] => ghosts.filter((g) => g.openTaskId === id).map((g) => g.date)

describe('C3 (Opus)', () => {
  it('only after today, never on the stored occurrence, and within the range', () => {
    const weekly = task('w', '2026-11-30', { freq: 'weekly', interval: 1, byWeekday: [1] })
    const ghosts = buildGhosts({ repeating: [weekly], routines: [], real: [], today: TODAY, from: FROM, to: TO })
    expect(datesOf(ghosts, 'w')).toEqual(['2026-12-07'])
  })

  it('a repeat left undone for a long time still shows in the visible month (no silent cut-off)', () => {
    // 매일 반복의 저장된 회차가 1년 전에 멈춰 있다. 보이는 달에도 앞으로의 회차가 흐리게 보여야 한다.
    const daily = task('d', '2025-11-26', { freq: 'daily', interval: 1 })
    const ghosts = buildGhosts({ repeating: [daily], routines: [], real: [], today: TODAY, from: FROM, to: TO })
    const dates = datesOf(ghosts, 'd')
    expect(dates[0]).toBe('2026-11-27')
    expect(dates.at(-1)).toBe(TO)
  })

  it('every-other-week keeps its cycle from the anchor', () => {
    const biweekly = task('b', '2026-11-23', { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-11-23' } as RepeatRule)
    const ghosts = buildGhosts({ repeating: [biweekly], routines: [], real: [], today: TODAY, from: FROM, to: '2026-12-31' })
    expect(datesOf(ghosts, 'b')).toEqual(['2026-12-07', '2026-12-21'])
  })

  it('monthly on the 31st falls back to the last day in short months', () => {
    const monthly = task('m', '2026-10-31', { freq: 'monthly', interval: 1, byMonthDay: 31 })
    const ghosts = buildGhosts({ repeating: [monthly], routines: [], real: [], today: TODAY, from: FROM, to: TO })
    expect(datesOf(ghosts, 'm')).toEqual(['2026-11-30'])
  })

  it('done, canceled, checklist-born and non-repeating tasks make no ghosts', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 1 }
    const ghosts = buildGhosts({
      repeating: [
        task('done', '2026-11-27', rule, { status: 'done' }),
        task('canceled', '2026-11-27', rule, { status: 'canceled' }),
        task('routine', '2026-11-27', rule, { routineId: 'r1' }),
        task('plain', '2026-11-27', null)
      ],
      routines: [],
      real: [],
      today: TODAY,
      from: FROM,
      to: TO
    })
    expect(ghosts).toEqual([])
  })

  it('checklist items: future matching weekdays only, skipping days that already have the real item, inactive ones never', () => {
    const ghosts = buildGhosts({
      repeating: [],
      routines: [
        { id: 'r1', title: '스트레칭', days: [1], active: true },
        { id: 'r2', title: '꺼 둔 항목', days: [1, 2, 3, 4, 5, 6, 0], active: false }
      ],
      real: [{ routineId: 'r1', date: '2026-11-30' }],
      today: TODAY,
      from: FROM,
      to: TO
    })
    expect(ghosts.map((g) => `${g.title}@${g.date}`)).toEqual(['스트레칭@2026-12-07'])
  })
})

import { describe, expect, it } from 'vitest'
import { countByDate, groupDayTasks } from '../../src/shared/calendar/day'
import type { Task } from '../../src/shared/tasks/types'
import { formatDayTitle, formatMonthTitle } from '../../src/renderer/home/calendar/format'

// C1-02, C1-05: 날짜별 목록의 시간 구분·정렬, 날짜 칸의 개수, 상세 제목.

const task = (over: Partial<Task> & { id: string; title: string }): Task => ({
  notes: '',
  status: 'open',
  bucket: 'scheduled',
  date: '2026-03-10',
  time: null,
  deadline: null,
  priority: 0,
  project: null,
  tags: [],
  repeat: null,
  routineId: null,
  source: null,
  order: 0,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  doneAt: null,
  ...over
})

describe('groupDayTasks', () => {
  it('splits timed and untimed items; timed items go in time order and equal times keep the given order', () => {
    const tasks = [
      task({ id: '1', title: '시간 없음', time: null }),
      task({ id: '2', title: '오후', time: '15:00' }),
      task({ id: '3', title: '아침 첫째', time: '09:00' }),
      task({ id: '4', title: '아침 둘째', time: '09:00' })
    ]
    const grouped = groupDayTasks(tasks)
    expect(grouped.timed.map((t) => t.title)).toEqual(['아침 첫째', '아침 둘째', '오후'])
    expect(grouped.untimed.map((t) => t.title)).toEqual(['시간 없음'])
  })

  it('keeps completed items in the list so they can be marked as done', () => {
    const grouped = groupDayTasks([task({ id: '1', title: '끝남', status: 'done', doneAt: '2026-03-10T10:00:00.000Z' })])
    expect(grouped.untimed.map((t) => [t.title, t.status])).toEqual([['끝남', 'done']])
  })

  it('does not mutate the input array', () => {
    const tasks = [task({ id: '1', title: 'b', time: '10:00' }), task({ id: '2', title: 'a', time: '09:00' })]
    groupDayTasks(tasks)
    expect(tasks.map((t) => t.id)).toEqual(['1', '2'])
  })
})

describe('countByDate', () => {
  it('counts all items and the completed ones per date', () => {
    const counts = countByDate([
      task({ id: '1', title: 'a', date: '2026-03-10' }),
      task({ id: '2', title: 'b', date: '2026-03-10', status: 'done', doneAt: '2026-03-10T10:00:00.000Z' }),
      task({ id: '3', title: 'c', date: '2026-03-11' })
    ])
    expect(counts.get('2026-03-10')).toEqual({ total: 2, done: 1 })
    expect(counts.get('2026-03-11')).toEqual({ total: 1, done: 0 })
    expect(counts.get('2026-03-12')).toBeUndefined()
  })
})

describe('calendar titles', () => {
  it('the day title has the weekday and says 오늘 only for today', () => {
    expect(formatDayTitle('2026-11-25', '2026-11-25')).toBe('2026년 11월 25일 (수) · 오늘')
    expect(formatDayTitle('2026-11-26', '2026-11-25')).toBe('2026년 11월 26일 (목)')
    expect(formatDayTitle('2026-11-24', '2026-11-25')).not.toContain('오늘')
  })

  it('the month title is the year and month', () => {
    expect(formatMonthTitle({ year: 2026, month: 11 })).toBe('2026년 11월')
    expect(formatMonthTitle({ year: 2027, month: 1 })).toBe('2027년 1월')
  })
})

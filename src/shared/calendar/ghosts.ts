// 달력에 흐리게 보이는 '예정(반복)': 저장하지 않고 계산만 한 앞으로의 회차. 순수 함수만 있다.
import type { Routine } from '../routines/types'
import { addDays, diffDays, weekdayOf } from '../tasks/dates'
import { futureOccurrences } from '../tasks/repeat'
import type { Task } from '../tasks/types'

export interface Ghost {
  /** 목록 key 로 쓰는 안정된 값 */
  id: string
  date: string
  title: string
  time: string | null
  kind: 'repeat' | 'checklist'
  /** 반복 할 일이면 이미 저장된 실제 회차(가장 가까운 하나). 누르면 이 할 일의 상세로 간다. 체크리스트 항목은 null. */
  openTaskId: string | null
  /** 그 실제 회차의 날짜 */
  openDate: string | null
}

/** 한 번에 보는 범위(달력 42칸)를 넉넉히 덮는 상한 */
const MAX_RANGE_DAYS = 70

interface BuildInput {
  /** 아직 끝나지 않은 반복 할 일(저장된 가장 가까운 회차). 반복이 없는 것은 무시한다. */
  repeating: readonly Task[]
  routines: readonly Pick<Routine, 'id' | 'title' | 'days' | 'active'>[]
  /** from..to 에 이미 저장된 할 일(체크리스트 항목이 이미 있는 날을 건너뛰는 데 쓴다) */
  real: readonly Pick<Task, 'routineId' | 'date'>[]
  today: string
  from: string
  to: string
}

/** 오늘 뒤의 날짜에만 만든다. 이미 저장된 회차와 겹치지 않는다(반복은 저장된 회차 '뒤'부터, 체크리스트는 그날 항목이 없을 때만). */
export function buildGhosts({ repeating, routines, real, today, from, to }: BuildInput): Ghost[] {
  if (diffDays(to, from) > MAX_RANGE_DAYS) return []
  const first = from > today ? from : addDays(today, 1)
  const ghosts: Ghost[] = []

  for (const task of repeating) {
    if (task.repeat === null || task.status !== 'open' || task.date === null || task.routineId !== null) continue
    for (const date of futureOccurrences(task.repeat, task.date, first, to)) {
      ghosts.push({ id: `${task.id}:${date}`, date, title: task.title, time: task.time, kind: 'repeat', openTaskId: task.id, openDate: task.date })
    }
  }

  const existing = new Set(real.filter((task) => task.routineId !== null && task.date !== null).map((task) => `${task.routineId}:${task.date}`))
  for (const routine of routines) {
    if (!routine.active) continue
    for (let date = first; date <= to; date = addDays(date, 1)) {
      if (!routine.days.includes(weekdayOf(date)) || existing.has(`${routine.id}:${date}`)) continue
      ghosts.push({ id: `${routine.id}:${date}`, date, title: routine.title, time: null, kind: 'checklist', openTaskId: null, openDate: null })
    }
  }

  return ghosts.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title))
}

/** 날짜별 개수 */
export function countGhosts(ghosts: readonly Ghost[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ghost of ghosts) counts.set(ghost.date, (counts.get(ghost.date) ?? 0) + 1)
  return counts
}

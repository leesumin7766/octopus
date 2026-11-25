// 날짜 하나에 걸린 할 일을 보기 좋게 나누고 셈. 순수 함수만 있다.
import type { Task } from '../tasks/types'

export interface DayGroups {
  /** 시간이 있는 할 일: 시간순. 같은 시각은 받은 순서를 지킨다. */
  timed: Task[]
  /** 시간이 없는 할 일: 받은 순서 그대로. */
  untimed: Task[]
}

export function groupDayTasks(tasks: readonly Task[]): DayGroups {
  // Array.prototype.sort 는 안정 정렬이라 같은 시각끼리는 원래 순서가 남는다.
  const timed = tasks.filter((task) => task.time !== null).sort((a, b) => (a.time as string).localeCompare(b.time as string))
  const untimed = tasks.filter((task) => task.time === null)
  return { timed, untimed }
}

export interface DayCount {
  /** 열린 것과 끝난 것을 모두 센다(취소는 저장소가 이미 뺐다). */
  total: number
  done: number
}

/** 날짜별 개수. 날짜가 없는 할 일은 세지 않는다. */
export function countByDate(tasks: readonly Task[]): Map<string, DayCount> {
  const counts = new Map<string, DayCount>()
  for (const task of tasks) {
    if (task.date === null) continue
    const current = counts.get(task.date) ?? { total: 0, done: 0 }
    counts.set(task.date, { total: current.total + 1, done: current.done + (task.status === 'done' ? 1 : 0) })
  }
  return counts
}

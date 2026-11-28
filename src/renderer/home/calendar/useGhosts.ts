import { useEffect, useRef, useState } from 'react'
import { buildGhosts, type Ghost } from '../../../shared/calendar/ghosts'
import type { Routine } from '../../../shared/routines/types'
import type { Task } from '../../../shared/tasks/types'
import { safeInvoke } from '../../safeInvoke'
import { todayString } from '../../tasks/format'

/**
 * from..to 의 '예정(반복)'(저장하지 않고 계산만 한 앞으로의 반복 회차·체크리스트 항목)을 돌려준다.
 * 열린 반복 할 일(오늘 보기 + 예정 보기)과 체크리스트 항목을 읽어 계산한다. 새 IPC 는 없다.
 * real 은 같은 구간에 이미 저장된 할 일(읽기 전이면 null → 아직 계산하지 않는다). 꾸밈이라 읽기에 실패하면 조용히 비운다.
 */
export function useGhosts(from: string, to: string, stamp: string, real: readonly Task[] | null): Ghost[] {
  const [source, setSource] = useState<{ repeating: Task[]; routines: Routine[] } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    void (async () => {
      const [todayList, upcoming, routines] = await Promise.all([
        safeInvoke(() => window.octopus.tasks.list('today')),
        safeInvoke(() => window.octopus.tasks.list('upcoming')),
        safeInvoke(() => window.octopus.routines.list())
      ])
      if (id !== seq.current) return
      const repeating: Task[] = []
      if (todayList.ok) repeating.push(...todayList.data.overdue, ...todayList.data.today)
      if (upcoming.ok) repeating.push(...upcoming.data)
      setSource({ repeating: repeating.filter((task) => task.repeat !== null), routines: routines.ok ? routines.data.routines : [] })
    })()
    return () => {
      seq.current++
    }
  }, [from, to, stamp])

  const [ghosts, setGhosts] = useState<Ghost[]>([])
  useEffect(() => {
    if (source === null || real === null) return
    setGhosts(buildGhosts({ repeating: source.repeating, routines: source.routines, real, today: todayString(), from, to }))
  }, [source, real, from, to])
  return ghosts
}

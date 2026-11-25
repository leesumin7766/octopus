import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../../shared/tasks/types'
import { safeInvoke } from '../../safeInvoke'

export type RangeState = { status: 'loading' } | { status: 'ready'; tasks: Task[] } | { status: 'error' }

/**
 * from..to 의 할 일을 읽는다.
 * - 구간(from, to)이 바뀌면 로딩으로 바꾸고 새로 읽는다.
 * - stamp(갱신 신호·오늘 날짜)가 바뀌면 같은 구간을 다시 읽는다. 이때 이전 결과는 응답이 올 때까지 그대로 두어 깜빡이지 않는다.
 * - 창이 다시 포커스를 얻거나 화면이 다시 보이면 다시 읽는다(다른 창에서 돌아온 경우).
 * - 정리(cleanup)된 뒤 도착한 응답은 버린다. 빠르게 날짜를 넘겨도 현재 구간을 덮어쓰지 않는다.
 * 다시 읽기가 실패하면 오류로 바꾼다(이전 값을 성공처럼 남기지 않는다).
 */
export function useTasksInRange(from: string, to: string, stamp: string): { state: RangeState; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RangeState>({ status: 'loading' })
  const lastRange = useRef<string | null>(null)

  useEffect(() => {
    const range = `${from}|${to}`
    const sameRange = lastRange.current === range
    lastRange.current = range

    let current = true
    setState((previous) => (sameRange && previous.status === 'ready' ? previous : { status: 'loading' }))
    void (async () => {
      const result = await safeInvoke(() => window.octopus.tasks.listRange(from, to))
      if (!current) return
      setState(result.ok ? { status: 'ready', tasks: result.data } : { status: 'error' })
    })()
    return () => {
      current = false
    }
  }, [from, to, stamp, attempt])

  useEffect(() => {
    const again = (): void => setAttempt((n) => n + 1)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') again()
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return { state, retry: () => setAttempt((n) => n + 1) }
}

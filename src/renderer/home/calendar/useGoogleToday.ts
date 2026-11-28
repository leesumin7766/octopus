import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarToday } from '../../../shared/calendar/types'
import { ko } from '../../i18n/ko'
import { safeInvoke } from '../../safeInvoke'
import { msUntilNextMidnight } from '../../tasks/format'

/** 일정을 다시 읽는 주기(진행 중·지난 일정 표시도 함께 갱신된다) */
export const GOOGLE_REFRESH_MS = 60_000

/**
 * 오늘의 Google 일정을 읽는다(홈과 달력 화면이 같이 쓴다).
 * - 처음, refreshKey 가 바뀔 때, 1분마다, 창이 다시 포커스를 받을 때, 자정이 지났을 때 다시 읽는다.
 * - 늦게 온 응답이 더 나중에 시작한 읽기의 결과를 덮지 않게 순번을 둔다.
 * - 읽지 못하면(main 무응답 등) 오류 상태로 바꾸고(readFailed) 다음 주기에 다시 읽는다. 앱은 계속 쓴다.
 * afterLoad 는 응답을 받은 뒤 상태를 바꾸기 전에 부르는 곁일(홈의 옵시디언 상태 읽기 등).
 */
export function useGoogleToday(refreshKey: number, afterLoad?: () => Promise<void>) {
  const [calendar, setCalendar] = useState<CalendarToday | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [midnightTick, setMidnightTick] = useState(0)
  const seq = useRef(0)
  const mounted = useRef(true)
  const afterLoadRef = useRef(afterLoad)
  afterLoadRef.current = afterLoad

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    const id = ++seq.current
    const result = await safeInvoke(() => window.octopus.calendar.today())
    if (!mounted.current || id !== seq.current) return
    setNow(new Date())
    await afterLoadRef.current?.()
    if (!mounted.current || id !== seq.current) return
    setReadFailed(!result.ok)
    setCalendar(result.ok ? result.data : { configured: true, status: { state: 'error', reason: ko.home.calendar.loadFailed }, events: [] })
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), GOOGLE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [reload, refreshKey])

  // 창이 다시 포커스를 받으면 바로 다시 읽는다.
  useEffect(() => {
    const onFocus = (): void => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  // 자정이 지나면 다시 읽는다(오늘 일정이 바뀐다).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload()
      setMidnightTick((tick) => tick + 1)
    }, msUntilNextMidnight(new Date()) + 1000)
    return () => window.clearTimeout(timer)
  }, [midnightTick, reload])

  return { calendar, now, readFailed, loading: calendar === null, reload }
}

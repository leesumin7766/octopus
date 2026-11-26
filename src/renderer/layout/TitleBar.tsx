import { useEffect, useState } from 'react'
import { formatHomeDate, msUntilNextMidnight, todayString } from '../tasks/format'
import { NoticeBell } from '../notices/NoticeBell'

/** macOS 는 왼쪽에 신호등 버튼이 있어 그만큼 비운다. Windows·Linux 는 오른쪽에 OS 가 창 버튼을 그린다. */
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

/**
 * 창 맨 위 40px 제목 표시줄(OS 창 틀을 숨기고 앱이 그린다). 가운데에 오늘 날짜.
 * 이 줄을 끌어 창을 옮긴다. 대화상자의 배경은 app-no-drag 라서, 대화상자가 열린 동안에는 끌리지 않고 눌린다.
 */
export function TitleBar() {
  const [day, setDay] = useState(todayString)

  // 자정이 지나면 날짜를 새로 쓴다.
  useEffect(() => {
    const timer = window.setTimeout(() => setDay(todayString()), msUntilNextMidnight(new Date()) + 1000)
    return () => window.clearTimeout(timer)
  }, [day])

  return (
    <header className={`app-drag relative flex h-10 shrink-0 items-center border-b border-line bg-page ${isMac ? 'pl-20' : 'pl-4'}`}>
      <NoticeBell />
      <time dateTime={day} className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-semibold text-ink">
        {formatHomeDate(new Date())}
      </time>
    </header>
  )
}

import { useEffect, useState } from 'react'

/** 이 폭(px) 이하의 창은 좁은 창이다: 홈은 카드를 한 열로 쌓고, 왼쪽 메뉴는 접힌 모양으로 보인다. */
export const NARROW_MAX_PX = 760

export function isNarrowWidth(width: number): boolean {
  return width <= NARROW_MAX_PX
}

/** 창이 좁은지(창 크기가 바뀔 때마다 다시 본다). */
export function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => isNarrowWidth(window.innerWidth))
  useEffect(() => {
    const onResize = (): void => setNarrow(isNarrowWidth(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}

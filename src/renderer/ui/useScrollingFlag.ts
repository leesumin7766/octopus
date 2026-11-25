import { useCallback, useEffect, useRef } from 'react'

/** 스크롤이 멈춘 뒤 스크롤바를 숨기기까지(ms) */
export const SCROLL_IDLE_MS = 900

/**
 * 사용자가 스크롤하는 동안에만 data-scrolling 을 붙인다. CSS(.scroll-quiet)가 그동안만 스크롤바를 그린다.
 * 돌려준 onScroll 을 스크롤되는 요소에 단다.
 */
export function useScrollingFlag(): (event: { currentTarget: HTMLElement }) => void {
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return useCallback((event: { currentTarget: HTMLElement }) => {
    const element = event.currentTarget
    element.setAttribute('data-scrolling', '')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => element.removeAttribute('data-scrolling'), SCROLL_IDLE_MS)
  }, [])
}

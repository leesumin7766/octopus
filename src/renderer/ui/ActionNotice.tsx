import { useEffect } from 'react'

/** 알림이 떠 있는 시간(ms) */
export const NOTICE_MS = 6000

interface ActionNoticeProps {
  message: string
  actionLabel: string
  onAction: () => void
  /** 시간이 지나 저절로 사라질 때 */
  onExpire: () => void
  /** 위치·크기를 정하는 클래스(색과 모양은 이 부품이 정한다) */
  className?: string
}

/**
 * 글 하나와 버튼 하나가 있는 짧은 알림(되돌리기·[보기] 등). 6초 뒤 저절로 사라진다.
 * 새 알림으로 바꿀 때는 부모가 key 를 바꿔 시간을 다시 센다.
 */
export function ActionNotice({ message, actionLabel, onAction, onExpire, className = '' }: ActionNoticeProps) {
  useEffect(() => {
    const timer = window.setTimeout(onExpire, NOTICE_MS)
    return () => window.clearTimeout(timer)
    // 시간은 알림이 뜰 때 한 번만 센다(부모가 다시 그려도 늘어나지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div role="status" className={`flex items-center gap-2.5 rounded-[8px] bg-[#1f1f1d] px-3 py-1.5 text-xs text-[#f6f6f3] ${className}`}>
      <span className="min-w-0 truncate">{message}</span>
      <button type="button" onClick={onAction} className="shrink-0 font-semibold text-[#c9cdf7] hover:underline">
        {actionLabel}
      </button>
    </div>
  )
}

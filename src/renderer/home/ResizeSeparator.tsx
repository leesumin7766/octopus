import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { MAX_RATIO, MIN_RATIO, ratioFromPointer, stepRatio } from '../../shared/home/layout'

interface ResizeSeparatorProps {
  orientation: 'vertical' | 'horizontal'
  /** 지금 경계 위치(%) */
  value: number
  label: string
  /** 경계를 끌거나 화살표로 옮길 때마다 */
  onChange: (value: number) => void
  /** 끌기가 끝났을 때, 화살표를 눌렀을 때, 두 번 눌렀을 때(저장할 때) */
  onCommit: () => void
  /** 두 번 누르면 50/50 */
  onReset: () => void
  /** 위치(%)의 기준이 되는 영역 — 카드 격자 */
  areaRef: RefObject<HTMLElement | null>
  style: CSSProperties
}

/**
 * 카드 사이 경계. 마우스·터치는 포인터 캡처로 똑같이 끌고, 키보드는 포커스 후 화살표 5%씩,
 * 두 번 누르면 반반. 값은 25~75% 로 제한된다.
 */
export function ResizeSeparator({ orientation, value, label, onChange, onCommit, onReset, areaRef, style }: ResizeSeparatorProps) {
  const vertical = orientation === 'vertical'
  // 끄는 동안 값이 바뀌어 다시 그려져도 끌기 상태가 이어지도록 ref 에 둔다.
  const dragging = useRef(false)

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    dragging.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return
    const rect = areaRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = vertical
      ? ratioFromPointer(event.clientX - rect.left, rect.width)
      : ratioFromPointer(event.clientY - rect.top, rect.height)
    if (ratio !== null) onChange(ratio)
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onCommit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const back = vertical ? 'ArrowLeft' : 'ArrowUp'
    const forward = vertical ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== back && event.key !== forward) return
    event.preventDefault()
    onChange(stepRatio(value, event.key === forward ? 1 : -1))
    onCommit()
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={MIN_RATIO}
      aria-valuemax={MAX_RATIO}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={() => {
        onReset()
        onCommit()
      }}
      onKeyDown={handleKeyDown}
      style={{ ...style, touchAction: 'none' }}
      className={`group flex items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        vertical ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
    >
      <span
        aria-hidden="true"
        className={`rounded-full bg-transparent group-hover:bg-accent/40 group-focus-visible:bg-accent/60 ${
          vertical ? 'h-12 w-0.5' : 'h-0.5 w-12'
        }`}
      />
    </div>
  )
}

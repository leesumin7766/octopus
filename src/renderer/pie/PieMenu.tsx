import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { PIE_SLOT_COUNT } from '../../shared/pie/actions'
import { releaseOutcome, slotAngles, slotCenterPoint, slotFromPoint, stepSlot } from '../../shared/pie/geometry'
import { ko } from '../i18n/ko'
import { Icon } from '../ui/Icon'
import type { SlotInfo } from './actions'

const t = ko.pie

/** 원형 메뉴 그림의 크기(px)와 부채꼴 반지름, 칸 이름을 놓을 반지름 */
const SIZE = 320
const CENTER = SIZE / 2
const WEDGE_RADIUS = SIZE / 2
const LABEL_RADIUS = 104

function wedgePath(index: number): string {
  const { start, end } = slotAngles(index)
  const point = (degrees: number): string => {
    const radians = (degrees * Math.PI) / 180
    return `${(CENTER + WEDGE_RADIUS * Math.cos(radians)).toFixed(2)} ${(CENTER + WEDGE_RADIUS * Math.sin(radians)).toFixed(2)}`
  }
  return `M${CENTER} ${CENTER} L${point(start)} A${WEDGE_RADIUS} ${WEDGE_RADIUS} 0 0 1 ${point(end)} Z`
}

/** 요소의 가운데에서 본 포인터 위치가 가리키는 칸 */
function slotAt(clientX: number, clientY: number, element: HTMLElement): number | null {
  const rect = element.getBoundingClientRect()
  return slotFromPoint(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2))
}

interface PieMenuProps {
  slots: SlotInfo[]
  /** 쓸 수 있는 칸을 골랐을 때. 메뉴는 먼저 닫힌다. */
  onRun: (slot: SlotInfo) => void
  /** 개발용 캡처에서 열린 채로 시작하기 위한 값 */
  initialOpen?: boolean
  initialHover?: number | null
  /**
   * 좁은 창: 원 버튼을 창 오른쪽 아래에 띄우고, 메뉴가 열릴 때 창 밖으로 잘리지 않게 옮긴다.
   * 버튼 자체는 BUTTON_EDGE 만큼 떨어진 자리에 있다.
   */
  floating?: boolean
}

/** 떠 있는 원 버튼의 가장자리 여백과 크기 절반(px). 원 버튼 지름은 68px. */
const FLOAT_EDGE = 16
const FLOAT_HALF = 34
/** 메뉴가 창 가장자리에서 떨어져 있어야 할 최소 여백(px) */
const MENU_MARGIN = 8

/** 떠 있는 원 버튼 기준으로 메뉴가 창 안에 들어오도록 옮길 거리(x, y px). 들어오면 0. */
export function floatingShift(windowWidth: number, windowHeight: number): { x: number; y: number } {
  const anchorX = windowWidth - FLOAT_EDGE - FLOAT_HALF
  const anchorY = windowHeight - FLOAT_EDGE - FLOAT_HALF
  const half = CENTER + MENU_MARGIN
  const clamp = (value: number, max: number): number => Math.min(Math.max(value, half), Math.max(half, max - half))
  return { x: clamp(anchorX, windowWidth) - anchorX, y: clamp(anchorY, windowHeight) - anchorY }
}

/**
 * 홈 가운데의 원 버튼과 8칸 원형 메뉴.
 * - 누르고 끌기: 메뉴가 펼쳐지고, 가리킨 칸이 강조되며, 놓으면 실행된다(가운데 데드존에서는 선택 없음).
 * - 짧게 누르기: 열린 채로 있고 칸을 눌러 실행한다. 바깥이나 원을 누르면 닫힌다.
 * - 키보드: 원에 포커스 후 Enter/Space 로 열고, Tab·화살표로 칸을 옮기고, Enter 로 실행, Esc 로 닫고 원으로 돌아온다.
 * 마우스·터치는 포인터 캡처로 똑같이 동작한다.
 */
export function PieMenu({ slots, onRun, initialOpen = false, initialHover = null, floating = false }: PieMenuProps) {
  const [open, setOpen] = useState(initialOpen)
  const [hover, setHover] = useState<number | null>(initialHover)
  const [focusRequest, setFocusRequest] = useState<number | null>(null)
  const circleRef = useRef<HTMLButtonElement>(null)
  const wedgeRefs = useRef<(HTMLButtonElement | null)[]>([])
  const press = useRef<{ x: number; y: number; time: number; wasOpen: boolean } | null>(null)

  function close(returnFocus = false): void {
    setOpen(false)
    setHover(null)
    setFocusRequest(null)
    if (returnFocus) circleRef.current?.focus()
  }

  function run(slot: SlotInfo): void {
    // 지금 쓸 수 없는 칸은 놓아도 아무 일도 없다(메뉴도 그대로 두어 이유를 읽을 수 있게 한다).
    if (!slot.enabled) return
    // 포커스를 원으로 돌려 둔다: 열리는 대화상자가 이 자리를 기억했다가, 닫을 때 키보드 사용자를 여기로 돌려보낸다.
    close(true)
    onRun(slot)
  }

  // Esc 로 닫고 원으로 포커스를 돌려준다.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      setHover(null)
      setFocusRequest(null)
      circleRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 키보드로 열었을 때 첫 칸으로 포커스를 옮긴다.
  useEffect(() => {
    if (open && focusRequest !== null) wedgeRefs.current[focusRequest]?.focus()
  }, [open, focusRequest])

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
    press.current = { x: event.clientX, y: event.clientY, time: Date.now(), wasOpen: open }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setOpen(true)
    setHover(null)
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>): void {
    if (!press.current) return
    setHover(slotAt(event.clientX, event.clientY, event.currentTarget))
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>): void {
    const started = press.current
    press.current = null
    if (!started) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    const slot = slotAt(event.clientX, event.clientY, event.currentTarget)
    const outcome = releaseOutcome({
      slot,
      distance: Math.hypot(event.clientX - started.x, event.clientY - started.y),
      durationMs: Date.now() - started.time,
      wasOpen: started.wasOpen
    })

    if (outcome === 'run' && slot !== null) run(slots[slot])
    else if (outcome === 'close') close()
    // 'keep-open': 그대로 둔다.
  }

  function handlePointerCancel(): void {
    if (!press.current) return
    press.current = null
    close()
  }

  /** 마우스 클릭은 위의 포인터 처리가 맡는다. 키보드(Enter/Space)로 누른 클릭(detail 0)만 여기서 처리한다. */
  function handleCircleClick(event: { detail: number }): void {
    if (event.detail !== 0) return
    if (open) close(true)
    else {
      setOpen(true)
      setHover(null)
      setFocusRequest(0)
    }
  }

  function focusWedge(index: number): void {
    wedgeRefs.current[index]?.focus()
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const current = wedgeRefs.current.findIndex((el) => el === document.activeElement)
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
    if (!forward && !backward) return

    event.preventDefault()
    if (current < 0) focusWedge(forward ? 0 : PIE_SLOT_COUNT - 1)
    else focusWedge(stepSlot(current, forward ? 1 : -1))
  }

  const hovered = hover !== null ? slots[hover] : null
  const reason = hovered && !hovered.enabled ? hovered.reason : null

  const shift = floating ? floatingShift(window.innerWidth, window.innerHeight) : { x: 0, y: 0 }

  return (
    <>
      {open && (
        <div
          data-testid="pie-backdrop"
          aria-hidden="true"
          onClick={() => close()}
          className="app-no-drag fixed inset-0 z-40 bg-page/60"
        />
      )}

      <div
        className={floating ? 'pointer-events-none fixed z-50' : 'pointer-events-none relative z-50'}
        style={floating ? { right: FLOAT_EDGE + FLOAT_HALF, bottom: FLOAT_EDGE + FLOAT_HALF } : { gridRow: 2, gridColumn: 2 }}
      >
        {open && (
          <div
            role="menu"
            aria-label={t.wedgesLabel}
            onKeyDown={handleMenuKeyDown}
            onPointerMove={(event) => setHover(slotAt(event.clientX, event.clientY, event.currentTarget))}
            onPointerLeave={() => setHover(null)}
            style={{
              width: SIZE,
              height: SIZE,
              ...(floating ? { transform: `translate(${shift.x}px, ${shift.y}px)` } : {})
            }}
            className="pointer-events-auto absolute left-1/2 top-1/2 -ml-40 -mt-40 select-none animate-[pie-pop_140ms_ease-out]"
          >
            <svg aria-hidden="true" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0">
              {slots.map((slot) => (
                <path
                  key={slot.index}
                  d={wedgePath(slot.index)}
                  fill={hover === slot.index && slot.enabled ? '#3346c8' : slot.enabled ? '#cdd2f4' : '#e6e6e3'}
                  stroke="#8e98dd"
                  strokeWidth={1}
                />
              ))}
            </svg>

            {slots.map((slot) => {
              const { x, y } = slotCenterPoint(slot.index, LABEL_RADIUS)
              const active = hover === slot.index && slot.enabled
              return (
                <button
                  key={slot.index}
                  ref={(element) => {
                    wedgeRefs.current[slot.index] = element
                  }}
                  type="button"
                  role="menuitem"
                  aria-label={slot.label}
                  aria-disabled={slot.enabled ? undefined : 'true'}
                  title={slot.enabled ? slot.label : `${slot.label} — ${slot.reason ?? ''}`}
                  tabIndex={focusRequest === slot.index || (focusRequest === null && slot.index === 0) ? 0 : -1}
                  onClick={() => run(slot)}
                  onFocus={() => {
                    setHover(slot.index)
                    setFocusRequest(slot.index)
                  }}
                  style={{ left: Math.round(CENTER + x - 36), top: Math.round(CENTER + y - 28), width: 72, height: 56 }}
                  className={`absolute flex flex-col items-center justify-center gap-0.5 rounded-lg p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active ? 'text-white' : 'text-ink'
                  } ${slot.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                >
                  <Icon name={slot.icon} />
                  <span className="max-w-full truncate px-0.5 text-[11px] font-semibold leading-tight">{slot.label}</span>
                </button>
              )
            })}

            <p
              role="status"
              className="absolute left-1/2 top-full mt-1 w-64 -translate-x-1/2 rounded-lg bg-ink px-3 py-1.5 text-center text-xs text-white empty:hidden"
            >
              {reason}
            </p>
          </div>
        )}

        <button
          ref={circleRef}
          type="button"
          aria-label={t.menuLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          title={t.menuHint}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onClick={handleCircleClick}
          style={{ touchAction: 'none' }}
          className={`pointer-events-auto absolute left-1/2 top-1/2 flex size-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-white outline-none focus-visible:ring-4 focus-visible:ring-accent/40 ${
            open ? '' : 'shadow-[0_4px_14px_rgba(51,70,200,0.35)]'
          }`}
        >
          {/* 작은 문어 아이콘(나중에 교체) */}
          <svg aria-hidden="true" width="34" height="34" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M7 13a7 7 0 0 1 14 0v3" />
            <path d="M7 15c0 3-2 4-3 6" />
            <path d="M11 16c0 3-1 5-2 7" />
            <path d="M17 16c0 3 1 5 2 7" />
            <path d="M21 15c0 3 2 4 3 6" />
          </svg>
        </button>
      </div>
    </>
  )
}

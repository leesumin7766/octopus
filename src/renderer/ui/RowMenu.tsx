import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ko } from '../i18n/ko'

export interface RowMenuItem {
  label: string
  onSelect: () => void
  /** 지우기처럼 되돌릴 수 없는 동작은 붉게 */
  danger?: boolean
}

interface RowMenuProps {
  /** ⋯ 버튼의 접근성 이름. 예: "보고서 더보기" */
  title: string
  items: readonly RowMenuItem[]
}

/**
 * 행마다 늘 보이는 '더보기(⋯)' 버튼과 그 메뉴(터치·키보드용). role="menu".
 * ⋯ 에서 Enter/Space/↓ 로 열고, ↑↓ 로 옮기고, Enter 로 실행, Esc 로 닫으면 ⋯ 로 초점이 돌아온다. 바깥을 누르거나 Tab 을 눌러도 닫힌다.
 */
export function RowMenu({ title, items }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 열리면 첫 항목에 초점
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (items.length === 0) return null

  function focusItem(index: number): void {
    const count = items.length
    itemRefs.current[((index % count) + count) % count]?.focus()
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusItem(current + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        focusItem(current <= 0 ? items.length - 1 : current - 1)
        return
      case 'Home':
        event.preventDefault()
        focusItem(0)
        return
      case 'End':
        event.preventDefault()
        focusItem(items.length - 1)
        return
      case 'Escape':
        // 행·패널·대화상자의 Esc 가 같이 반응하지 않게 여기서 멈춘다.
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        buttonRef.current?.focus()
        return
      case 'Tab':
        setOpen(false)
        return
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ko.rowMenu.more(title)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="flex size-8 items-center justify-center rounded-lg text-lg leading-none text-[#4a4945] hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={ko.rowMenu.menu(title)}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 min-w-[9rem] rounded-lg border border-line bg-white p-1 shadow-lg"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-black/5 focus:bg-black/5 focus:outline-none ${item.danger ? 'text-red-600' : 'text-ink'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

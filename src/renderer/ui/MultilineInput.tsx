import type { KeyboardEvent, ReactNode } from 'react'
import { ko } from '../i18n/ko'

const t = ko.multiline

interface MultilineInputProps {
  value: string
  onChange: (value: string) => void
  /** Ctrl(Cmd)+Enter 또는 [저장] 버튼. 저장 중 재요청 막기는 부르는 쪽이 한다(ref). */
  onSave: () => void
  /** 칸의 접근성 이름(placeholder 를 이름 대신 쓰지 않는다) */
  label: string
  /** 입력 오류 문구(칸 아래에 알림으로) */
  error?: string | null
  /** [저장]을 못 누르게 할 때(빈 글, 저장 중 등) */
  saveDisabled?: boolean
  rows?: number
  maxLength?: number
  placeholder?: string
  autoFocus?: boolean
  /** Esc */
  onEscape?: () => void
  /** [저장] 옆에 더 둘 것(취소 버튼, 검색칸 등) */
  children?: ReactNode
}

/**
 * 여러 줄 입력(메모 화면의 새 메모·편집, 원형 메뉴의 메모 추가): Enter 는 줄바꿈, Ctrl/Cmd+Enter 는 저장.
 * [저장] 버튼과 키 안내를 늘 보여 준다. 한글 조합 중의 Enter 는 글자를 확정하는 키라서 무시한다.
 */
export function MultilineInput({
  value,
  onChange,
  onSave,
  label,
  error = null,
  saveDisabled = false,
  rows = 3,
  maxLength,
  placeholder,
  autoFocus = false,
  onEscape,
  children
}: MultilineInputProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    onSave()
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus={autoFocus}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full resize-y rounded-lg border border-[#dad9d4] bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saveDisabled}
          onClick={onSave}
          className="min-h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
        >
          {t.save}
        </button>
        <span className="text-xs text-[#5e5d58]">{t.keyHint}</span>
        {children}
      </div>
    </div>
  )
}

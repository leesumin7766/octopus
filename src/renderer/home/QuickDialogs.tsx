import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { IpcError } from '../../shared/ipc'
import { MAX_MEMO_LENGTH } from '../../shared/validation/memo'
import { ko } from '../i18n/ko'
import { errorMessage } from '../tasks/errors'
import { QuickInput } from '../tasks/QuickInput'

const t = ko.home.dialogs

interface DialogShellProps {
  label: string
  onClose: () => void
  children: ReactNode
}

/** 작은 대화상자 틀. Esc·바깥 클릭·닫기 버튼으로 닫히고, 닫히면 열기 전에 있던 곳으로 포커스가 돌아간다. */
function DialogShell({ label, onClose, children }: DialogShellProps) {
  const opener = useRef<Element | null>(document.activeElement)

  useEffect(() => {
    const previous = opener.current as HTMLElement | null
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="app-no-drag fixed inset-0 z-[60] flex items-start justify-center bg-ink/35 px-4 pt-24"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={label} className="flex w-full max-w-xl flex-col gap-3 rounded-[14px] bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{label}</h2>
          <button
            type="button"
            aria-label={t.close}
            onClick={onClose}
            className="size-9 rounded-lg text-lg text-[#4a4945] hover:bg-black/5"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

interface TaskQuickDialogProps {
  onClose: () => void
  /** 빠른 입력이 저장되면 */
  onAdded: () => void
  previewDebounceMs: number
}

/** 원형 메뉴의 "할 일 추가": 작은 대화상자에서 빠른 입력(칩 미리보기 포함). */
export function TaskQuickDialog({ onClose, onAdded, previewDebounceMs }: TaskQuickDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<IpcError | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function submit(text: string): Promise<boolean> {
    const result = await window.octopus.tasks.quickAdd(text)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    onAdded()
    return true
  }

  return (
    <DialogShell label={t.taskTitle} onClose={onClose}>
      <QuickInput inputRef={inputRef} onSubmit={submit} debounceMs={previewDebounceMs} />
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {errorMessage(error)}
        </p>
      )}
    </DialogShell>
  )
}

interface MemoQuickDialogProps {
  onClose: () => void
  onSaved: () => void
}

/** 원형 메뉴의 "메모": 작은 대화상자에서 메모 쓰기(Ctrl+Enter 로 저장). */
export function MemoQuickDialog({ onClose, onSaved }: MemoQuickDialogProps) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<IpcError | null>(null)

  async function save(): Promise<void> {
    if (body.trim() === '') return
    const result = await window.octopus.memos.create(body)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // 한글 입력 중에는 글자를 확정하는 Enter 라서 저장하지 않는다.
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return
    event.preventDefault()
    void save()
  }

  return (
    <DialogShell label={t.memoTitle} onClose={onClose}>
      <textarea
        autoFocus
        rows={4}
        value={body}
        maxLength={MAX_MEMO_LENGTH}
        aria-label={t.memoLabel}
        placeholder={t.memoPlaceholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full resize-y rounded-lg border border-[#dad9d4] px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {errorMessage(error)}
        </p>
      )}
      <div>
        <button
          type="button"
          disabled={body.trim() === ''}
          onClick={() => void save()}
          className="min-h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
        >
          {t.save}
        </button>
      </div>
    </DialogShell>
  )
}

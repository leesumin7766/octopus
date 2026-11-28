import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IpcError } from '../../shared/ipc'
import { MAX_MEMO_LENGTH } from '../../shared/validation/memo'
import { ko } from '../i18n/ko'
import { errorMessage } from '../tasks/errors'
import { safeInvoke } from '../safeInvoke'
import { QuickInput } from '../tasks/QuickInput'
import { MultilineInput } from '../ui/MultilineInput'
import { leftoverAfterSave } from '../memos/leftoverAfterSave'

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
  /** 저장이 성공하면 부른다. 인자는 칸에 남은 글(비었으면 닫아도 된다). */
  onSaved: (remaining: string) => void
}

/** 원형 메뉴의 "메모 추가": 작은 대화상자에서 메모 추가(여러 줄 입력: Ctrl+Enter 로 저장). */
export function MemoQuickDialog({ onClose, onSaved }: MemoQuickDialogProps) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<IpcError | null>(null)
  const [saving, setSaving] = useState(false)
  /** 저장 중에는 Enter·버튼 재요청을 막는다(ref 는 같은 순간의 두 번째 요청도 막는다). */
  const savingRef = useRef(false)
  const bodyRef = useRef(body)
  bodyRef.current = body
  /** 대화상자가 닫혔는지. 닫힌 뒤 도착한 저장 결과는 새로 연 대화상자를 건드리지 않게 무시한다. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function save(): Promise<void> {
    const sent = body
    if (savingRef.current || sent.trim() === '') return
    savingRef.current = true
    setSaving(true)
    let result: Awaited<ReturnType<typeof window.octopus.memos.create>>
    try {
      result = await safeInvoke(() => window.octopus.memos.create(sent))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
    if (!alive.current) return
    if (!result.ok) {
      setError(result.error)
      return
    }
    // 저장이 성공했으면 지난 실패 문구는 지운다.
    setError(null)
    // 저장하는 사이 더 쓴 글은 남긴다. 나머지가 있으면 대화상자는 그대로 두고, 알림·목록 갱신은 항상 한다.
    const remaining = leftoverAfterSave(bodyRef.current, sent)
    setBody(remaining)
    onSaved(remaining)
  }

  return (
    <DialogShell label={t.memoTitle} onClose={onClose}>
      <MultilineInput
        autoFocus
        rows={4}
        value={body}
        onChange={setBody}
        onSave={() => void save()}
        label={t.memoLabel}
        placeholder={t.memoPlaceholder}
        maxLength={MAX_MEMO_LENGTH}
        error={error ? errorMessage(error) : null}
        saveDisabled={body.trim() === '' || saving}
      />
    </DialogShell>
  )
}

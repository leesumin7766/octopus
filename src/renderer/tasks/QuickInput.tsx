import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { QuickParseResult } from '../../shared/tasks/quickParse'
import { MAX_TEXT_LENGTH } from '../../shared/validation/taskIpc'
import { ko } from '../i18n/ko'
import { formatDate, formatRepeat, todayString } from './format'

const t = ko.tasks

interface QuickInputProps {
  inputRef: RefObject<HTMLInputElement | null>
  /** Enter 를 누르면 호출. true 를 돌려주면 입력창을 비운다. */
  onSubmit: (text: string) => Promise<boolean>
  debounceMs: number
}

function chipsOf(preview: QuickParseResult): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = []
  if (preview.date) chips.push({ label: t.chip.date, value: formatDate(preview.date, todayString()) })
  if (preview.time) chips.push({ label: t.chip.time, value: preview.time })
  if (preview.project) chips.push({ label: t.chip.project, value: `#${preview.project}` })
  if (preview.priority > 0) chips.push({ label: t.chip.priority, value: t.priority[preview.priority] })
  if (preview.repeat) chips.push({ label: t.chip.repeat, value: formatRepeat(preview.repeat) })
  return chips
}

export function QuickInput({ inputRef, onSubmit, debounceMs }: QuickInputProps) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<QuickParseResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requestId = useRef(0)

  // 입력이 멈추면 저장 없이 파서 결과만 받아 칩으로 보여 준다.
  useEffect(() => {
    const id = ++requestId.current
    if (text.trim() === '') {
      setPreview(null)
      return
    }
    const timer = window.setTimeout(() => {
      void window.octopus.tasks.parsePreview(text).then((result) => {
        if (id === requestId.current) setPreview(result.ok ? result.data : null)
      })
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [text, debounceMs])

  async function submit(): Promise<void> {
    if (text.trim() === '' || submitting) return
    setSubmitting(true)
    try {
      if (await onSubmit(text)) {
        setText('')
        setPreview(null)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return
    // 한글 입력 중 Enter 는 글자를 확정하는 키라서 등록하지 않는다.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    void submit()
  }

  const chips = preview ? chipsOf(preview) : []

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        value={text}
        maxLength={MAX_TEXT_LENGTH}
        aria-label={t.quickInputLabel}
        placeholder={t.quickInputPlaceholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      {chips.length > 0 && (
        <ul aria-label={t.previewLabel} className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li key={chip.label} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-700">
              <span className="text-indigo-400">{chip.label}</span> {chip.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

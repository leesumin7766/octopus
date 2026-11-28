import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { QuickParseOptions, QuickParseResult } from '../../shared/tasks/quickParse'
import { MAX_TEXT_LENGTH } from '../../shared/validation/taskIpc'
import { ko } from '../i18n/ko'
import { useLeaveGuard } from '../leaveGuard'
import { formatDate, formatRepeat, todayString } from './format'
import { safeInvoke } from '../safeInvoke'

const t = ko.tasks

interface QuickInputProps {
  inputRef: RefObject<HTMLInputElement | null>
  /** Enter 를 누르거나 추가를 누르면 호출. true 를 돌려주면 입력창을 비운다. options 는 defaultDate·showTimeField 를 쓸 때만 온다. */
  onSubmit: (text: string, options?: QuickParseOptions) => Promise<boolean>
  debounceMs: number
  /** 입력칸 안내 문구. 없으면 할 일 화면의 기본 문구 */
  placeholder?: string
  /** 입력칸의 접근성 이름. 없으면 할 일 화면의 기본 이름 */
  label?: string
  /** 문장에 날짜가 없을 때 쓸 날짜(날짜 상세에서 쓴다) */
  defaultDate?: string
  /** 시각 칸을 보인다. 칸의 시각은 문장에 시각이 없을 때만 쓴다. */
  showTimeField?: boolean
  /** 쓰던 내용(글 또는 시각)이 있는지 바뀔 때마다 알린다. */
  onDirtyChange?: (dirty: boolean) => void
}

function chipsOf(preview: QuickParseResult, defaultDate: string | undefined): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = []
  if (preview.date) {
    const shown = formatDate(preview.date, todayString())
    let value = shown
    // 날짜 상세에서는 이 날짜를 쓰는지, 문장의 다른 날짜를 쓰는지 드러낸다.
    if (defaultDate !== undefined) {
      if (preview.dateFrom === 'default') value = t.chip.thisDate
      else if (preview.date !== defaultDate) value = t.chip.fromText(shown)
    }
    chips.push({ label: t.chip.date, value })
  }
  if (preview.time) chips.push({ label: t.chip.time, value: preview.time })
  if (preview.project) chips.push({ label: t.chip.project, value: `#${preview.project}` })
  if (preview.priority > 0) chips.push({ label: t.chip.priority, value: t.priority[preview.priority] })
  if (preview.repeat) chips.push({ label: t.chip.repeat, value: formatRepeat(preview.repeat) })
  return chips
}

/** 빠른 입력 카드: 입력줄과 추가 버튼, 아래에 "알아들은 것" 칩. */
export function QuickInput({
  inputRef,
  onSubmit,
  debounceMs,
  placeholder = t.quickInputPlaceholder,
  label = t.quickInputLabel,
  defaultDate,
  showTimeField = false,
  onDirtyChange
}: QuickInputProps) {
  const [text, setText] = useState('')
  const [time, setTime] = useState('')
  const [preview, setPreview] = useState<QuickParseResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const requestId = useRef(0)
  // 쓰던 글이 남아 있으면 화면을 옮기기 전에 묻는다.
  const dirty = text.trim() !== '' || time !== ''
  useLeaveGuard(dirty)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const options: QuickParseOptions | undefined =
    defaultDate !== undefined || (showTimeField && time !== '')
      ? { ...(defaultDate !== undefined ? { defaultDate } : {}), ...(showTimeField && time !== '' ? { defaultTime: time } : {}) }
      : undefined
  const optionsKey = JSON.stringify(options ?? null)

  // 입력이 멈추면 저장 없이 파서 결과만 받아 칩으로 보여 준다.
  useEffect(() => {
    const id = ++requestId.current
    if (text.trim() === '') {
      setPreview(null)
      return
    }
    const timer = window.setTimeout(() => {
      void safeInvoke(() => options ? window.octopus.tasks.parsePreview(text, options) : window.octopus.tasks.parsePreview(text)).then((result) => {
        if (id === requestId.current) setPreview(result.ok ? result.data : null)
      })
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [text, debounceMs, optionsKey])

  async function submit(): Promise<void> {
    if (text.trim() === '' || submitting) return
    setSubmitting(true)
    const sent = text
    const sentTime = time
    try {
      if (await (options ? onSubmit(sent, options) : onSubmit(sent))) {
        // 저장하는 동안 고쳐 쓴 내용은 남긴다.
        setText((current) => (current === sent ? '' : current))
        setTime((current) => (current === sentTime ? '' : current))
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

  const chips = preview ? chipsOf(preview, defaultDate) : []

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#E4E3DE] bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] text-ink outline-none placeholder:text-[#8A8984]"
        />
        {showTimeField && (
          <input
            type="time"
            aria-label={t.timeFieldLabel}
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={text.trim() === '' || submitting}
          className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
        >
          {t.quickAddButton}
        </button>
      </div>
      {/* 알아들은 것은 입력을 시작했을 때만 보인다(빈 칸일 때 설명 줄로 자리를 차지하지 않는다) */}
      {text.trim() !== '' && (
        <div className="flex min-h-6 flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#5E5D58]">{t.parsedLabel}</span>
          {chips.length > 0 ? (
            <ul aria-label={t.previewLabel} className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <li key={chip.label} className="rounded-full bg-[#E9EBFA] px-2.5 py-0.5 text-xs text-[#22309A]">
                  <span className="text-[#5E6BC0]">{chip.label}</span> {chip.value}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-[#5E5D58]">{t.parseHint}</span>
          )}
        </div>
      )}
    </div>
  )
}

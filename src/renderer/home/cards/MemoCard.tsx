import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { IpcError } from '../../../shared/ipc'
import type { Memo } from '../../../shared/memos/types'
import { MAX_MEMO_LENGTH } from '../../../shared/validation/memo'
import { ko } from '../../i18n/ko'
import { errorMessage } from '../../tasks/errors'
import { leftoverAfterSave } from '../../memos/leftoverAfterSave'
import { safeInvoke } from '../../safeInvoke'

const t = ko.home.memo

/** 미리보기에 보여 줄 메모 개수 */
const PREVIEW_COUNT = 5

interface MemoCardProps {
  /** 값이 바뀌면 목록을 다시 읽는다(대화상자에서 메모를 저장했을 때). */
  refreshKey?: number
}

/** 메모: 고정한 것 먼저 최근 5개의 첫 줄 미리보기, 한 줄 빠른 메모 입력. "전체 보기"는 카드 아래 고정 영역(HomeScreen)에 있다. */
export function MemoCard({ refreshKey = 0 }: MemoCardProps) {
  const [memos, setMemos] = useState<Memo[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<IpcError | null>(null)
  /** 저장 중인지. 재요청을 막는 데 쓰는 ref 와 짝이다(ref 는 같은 순간의 두 번째 요청도 막는다). */
  const savingRef = useRef(false)
  const loadSeq = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const result = await safeInvoke(() => window.octopus.memos.list())
    if (!mounted.current || seq !== loadSeq.current) return
    if (result.ok) setMemos(result.data.slice(0, PREVIEW_COUNT))
    else setError(result.error)
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, refreshKey])

  async function save(): Promise<void> {
    const sent = draft
    if (savingRef.current || sent.trim() === '') return
    savingRef.current = true
    let result: Awaited<ReturnType<typeof window.octopus.memos.create>>
    try {
      result = await safeInvoke(() => window.octopus.memos.create(sent))
    } finally {
      savingRef.current = false
    }
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    // 저장하는 사이 칸의 글이 바뀌었으면 전체를 그대로 남긴다(같으면 비운다).
    setDraft((current) => leftoverAfterSave(current, sent))
    await refresh()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // 한글 입력 중 Enter 는 글자를 확정하는 키라서 저장하지 않는다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    void save()
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {memos && memos.length === 0 ? (
        <p className="text-sm text-[#5e5d58]">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm leading-normal">
          {(memos ?? []).map((memo) => (
            <li key={memo.id} className="flex items-baseline gap-2">
              {memo.pinned && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700">{ko.memos.pinned}</span>
              )}
              {/* 본문은 글자 그대로(HTML 로 해석하지 않음), 첫 줄만 */}
              <span className="min-w-0 flex-1 truncate">{memo.body.split('\n')[0]}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {errorMessage(error)}
        </p>
      )}

      <input
        value={draft}
        maxLength={MAX_MEMO_LENGTH}
        aria-label={t.quickLabel}
        placeholder={t.quickPlaceholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-10 rounded-lg border border-[#dad9d4] bg-white px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />

    </div>
  )
}

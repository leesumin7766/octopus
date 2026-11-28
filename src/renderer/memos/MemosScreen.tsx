import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError, IpcResult } from '../../shared/ipc'
import type { Memo } from '../../shared/memos/types'
import type { Task } from '../../shared/tasks/types'
import { MAX_MEMO_LENGTH } from '../../shared/validation/memo'
import { MAX_SEARCH_LENGTH } from '../../shared/validation/memoIpc'
import { ErrorBanner } from '../ErrorBanner'
import { useDataChanged } from '../dataEvents'
import { ko } from '../i18n/ko'
import { useLeaveGuard, UnsavedStrip } from '../leaveGuard'
import { formatTimestamp } from '../tasks/format'
import { highlightMatches } from './highlight'
import { leftoverAfterSave } from './leftoverAfterSave'
import { safeInvoke } from '../safeInvoke'
import { ActionNotice } from '../ui/ActionNotice'
import { MultilineInput } from '../ui/MultilineInput'

const t = ko.memos

const api = () => window.octopus.memos

/** 다른 화면(홈 메모 카드)에서 온 요청: 그 메모를 보이게 하고 편집을 시작한다. nonce 가 바뀔 때마다 한 번씩 처리한다. */
export interface MemosFocus {
  memoId: string
  nonce: number
}

interface MemosScreenProps {
  focus?: MemosFocus
  /** '할 일로 만들기' 뒤 알림의 [보기]: 만든 할 일을 할 일 화면에서 연다. */
  onOpenTask?: (task: Task) => void
  /** 검색어 입력을 멈춘 뒤 검색하기까지의 대기 시간 */
  searchDebounceMs?: number
}

export function MemosScreen({ focus, onOpenTask, searchDebounceMs = 250 }: MemosScreenProps) {
  const [memos, setMemos] = useState<Memo[] | null>(null)
  const [query, setQuery] = useState('')
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)
  /** 할 일로 만든 직후의 안내 */
  const [madeTask, setMadeTask] = useState<Task | null>(null)
  /** 홈에서 눌러 온 메모(잠깐 강조한다) */
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const handledFocus = useRef<number | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string; invalid: boolean } | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  /** 쓰던 내용이 있을 때 다른 메모 편집을 시작하기 전에 묻는다. run 은 확인 뒤 실행할 일, editing 은 편집 중인 내용을 잃는지. */
  const [askLeave, setAskLeave] = useState<{ run: () => void; editing: boolean } | null>(null)
  /** 저장 중인지(새 메모·편집 각각). 재요청 막기는 ref 로, 버튼 비활성은 state 로 한다. */
  const [savingNew, setSavingNew] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const savingNewRef = useRef(false)
  const savingEditRef = useRef(false)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const queryRef = useRef(query)
  queryRef.current = query

  // 새 메모 초안이나 편집 중인 메모에 저장하지 않은 글이 있는지.
  const bodyDirty = body.trim() !== ''
  const editDirty = editing !== null && editing.text !== (memos?.find((memo) => memo.id === editing.id)?.body ?? editing.text)
  useLeaveGuard(bodyDirty || editDirty)

  /** 지금 검색어에 맞는 목록을 읽는다(검색어가 비어 있으면 전체). */
  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const text = queryRef.current.trim()
    const result = await safeInvoke(() => (text === '' ? api().list() : api().search(text)))
    if (!mounted.current || seq !== loadSeq.current) return
    if (result.ok) setMemos(result.data)
    else setError(result.error)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // 처음 한 번, 그리고 검색어가 바뀌고 입력이 멈추면 읽는다.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query.trim() === '' ? 0 : searchDebounceMs)
    return () => window.clearTimeout(timer)
  }, [query, searchDebounceMs, load])

  useEffect(() => {
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // 데이터가 바뀌면 목록만 다시 읽는다. 초안·편집 중인 글은 그대로 둔다.
  useDataChanged(() => void load())

  /** 다른 메모 편집을 시작한다. 쓰던 글이 있으면 먼저 묻는다. */
  function requestEdit(memo: Memo): void {
    if (editing?.id === memo.id) return
    const start = (): void => setEditing({ id: memo.id, text: memo.body, invalid: false })
    if (bodyDirty || editDirty) setAskLeave({ run: start, editing: editDirty })
    else start()
  }

  // 홈에서 메모를 눌러 왔으면: 목록이 오면 그 메모를 보이게 하고 편집을 시작한다(요청마다 한 번).
  useEffect(() => {
    if (!focus || !memos || handledFocus.current === focus.nonce) return
    handledFocus.current = focus.nonce
    const memo = memos.find((m) => m.id === focus.memoId)
    if (!memo) return
    setHighlightId(memo.id)
    requestEdit(memo)
    window.requestAnimationFrame(() => document.querySelector(`[data-memo-id="${memo.id}"]`)?.scrollIntoView?.({ block: 'nearest' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, memos])

  // 강조는 3초 뒤 꺼진다. 목록을 다시 읽어도 타이머가 지워지지 않게, 강조 대상에만 묶는다.
  useEffect(() => {
    if (highlightId === null) return
    const timer = window.setTimeout(() => setHighlightId(null), 3000)
    return () => window.clearTimeout(timer)
  }, [highlightId])

  /** 실패를 화면에 보인다(입력 오류는 칸 옆에서 따로 보여 주므로 여기서는 뺀다). */
  function reportFailure(failure: IpcError): void {
    setError(failure)
    if (failure.code === 'not_found') void load()
  }

  async function mutate<R>(run: () => Promise<IpcResult<R>>): Promise<IpcResult<R>> {
    const result = await safeInvoke(run)
    if (result.ok) {
      setError(null)
      await load()
    } else if (result.error.code !== 'invalid_input') {
      reportFailure(result.error)
    }
    return result
  }

  async function saveNew(): Promise<void> {
    const sent = body
    if (savingNewRef.current || sent.trim() === '') return
    savingNewRef.current = true
    setSavingNew(true)
    try {
      const result = await safeInvoke(() => api().create(sent))
      if (result.ok) {
        // 저장이 성공한 순간 칸을 정리한다. 목록 다시 읽기가 실패해도 저장한 부분을 또 보내지 않게.
        setError(null)
        setBody((current) => leftoverAfterSave(current, sent))
        setBodyError(false)
        await load()
      } else if (result.error.code === 'invalid_input') {
        setBodyError(true)
      } else {
        reportFailure(result.error)
      }
    } finally {
      savingNewRef.current = false
      setSavingNew(false)
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing || savingEditRef.current) return
    const { id, text } = editing
    savingEditRef.current = true
    setSavingEdit(true)
    try {
      const result = await safeInvoke(() => api().update(id, text))
      if (result.ok) {
        // 저장하는 사이 더 고친 글이 있으면 편집을 닫지 않는다.
        setError(null)
        setEditing((current) => (current?.id === id && current.text === text ? null : current))
        await load()
      } else if (result.error.code === 'invalid_input') {
        setEditing((current) => (current?.id === id ? { ...current, invalid: true } : current))
      } else {
        reportFailure(result.error)
      }
    } finally {
      savingEditRef.current = false
      setSavingEdit(false)
    }
  }

  async function makeTask(memo: Memo): Promise<void> {
    const result = await mutate(() => api().toTask(memo.id))
    setMadeTask(result.ok ? result.data.task : null)
  }

  async function remove(memo: Memo): Promise<void> {
    const result = await mutate(() => api().remove(memo.id))
    if (result.ok || result.error.code === 'not_found') setConfirmingId(null)
  }

  const searching = query.trim() !== ''

  return (
    <div className="flex h-full min-w-0 flex-col bg-page text-ink">
      <header className="space-y-2 border-b border-line bg-white px-5 py-3">
        <MultilineInput
          value={body}
          onChange={(value) => {
            setBody(value)
            setBodyError(false)
          }}
          onSave={() => void saveNew()}
          label={t.newLabel}
          placeholder={t.newPlaceholder}
          maxLength={MAX_MEMO_LENGTH}
          error={bodyError ? t.fieldErrors.body : null}
          saveDisabled={body.trim() === '' || savingNew}
        >
          <input
            type="search"
            value={query}
            maxLength={MAX_SEARCH_LENGTH}
            aria-label={t.searchLabel}
            placeholder={t.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            className="ml-auto w-56 rounded-md border border-[#dad9d4] bg-white px-3 py-1 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </MultilineInput>
      </header>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {askLeave && (
        <div className="px-5 pt-3">
          <UnsavedStrip
            title={askLeave.editing ? ko.home.localCalendar.editDiscardTitle : ko.home.localCalendar.discardTitle}
            onKeep={() => setAskLeave(null)}
            onDiscard={() => {
              const { run } = askLeave
              setAskLeave(null)
              // 버리기: 쓰던 초안과 편집 중인 글을 지우고 옮긴다.
              setBody('')
              setBodyError(false)
              run()
            }}
          />
        </div>
      )}
      {madeTask && (
        <div className="px-5 pt-3">
          <ActionNotice
            key={madeTask.id}
            message={t.madeTask}
            actionLabel={t.madeTaskView}
            onAction={() => {
              const task = madeTask
              setMadeTask(null)
              onOpenTask?.(task)
            }}
            onExpire={() => setMadeTask((current) => (current?.id === madeTask.id ? null : current))}
            className="self-start"
          />
        </div>
      )}

      <section aria-label={t.listLabel} className="flex-1 overflow-y-auto px-5 py-4">
        {!memos ? (
          error ? null : <p className="text-sm text-[#5e5d58]">{ko.tasks.loading}</p>
        ) : memos.length === 0 ? (
          <p className="text-sm text-[#5e5d58]">{searching ? t.noResults : t.empty}</p>
        ) : (
          <ul className="space-y-3">
            {memos.map((memo) => (
              <li
                key={memo.id}
                data-memo-id={memo.id}
                className={`group rounded-lg border bg-white p-3 ${memo.pinned ? 'border-amber-300' : 'border-line'} ${highlightId === memo.id ? 'ring-2 ring-accent' : ''}`}
              >
                {editing?.id === memo.id ? (
                  <MultilineInput
                    autoFocus
                    value={editing.text}
                    onChange={(value) => setEditing({ id: memo.id, text: value, invalid: false })}
                    onSave={() => void saveEdit()}
                    onEscape={() => setEditing(null)}
                    label={t.editLabel}
                    rows={5}
                    maxLength={MAX_MEMO_LENGTH}
                    error={editing.invalid ? t.fieldErrors.body : null}
                    saveDisabled={savingEdit}
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="min-h-9 rounded-lg border border-[#dad9d4] px-3 text-sm text-[#4a4945] hover:bg-black/5"
                    >
                      {t.cancel}
                    </button>
                  </MultilineInput>
                ) : (
                  <>
                    {memo.pinned && (
                      <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-700">
                        {t.pinned}
                      </span>
                    )}
                    {/* 본문은 마크다운 원문 그대로 보여 준다(HTML 로 해석하지 않고 줄바꿈만 보존). */}
                    <button
                      type="button"
                      aria-label={`${t.edit}: ${memo.body.slice(0, 40)}`}
                      onClick={() => requestEdit(memo)}
                      className="block w-full text-left"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">{searching ? highlightMatches(memo.body, query) : memo.body}</p>
                    </button>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-[#8a8983]">{t.updated(formatTimestamp(memo.updatedAt))}</span>
                      {/* 동작은 마우스를 올리거나 키보드로 들어갔을 때만 보인다 */}
                      <span className="ml-auto flex flex-wrap gap-1.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void mutate(() => api().togglePin(memo.id))}
                          className="rounded px-2 py-1 text-[#4a4945] hover:bg-black/5"
                        >
                          {memo.pinned ? t.unpin : t.pin}
                        </button>
                        {memo.taskId === null ? (
                          <button
                            type="button"
                            onClick={() => void makeTask(memo)}
                            className="rounded px-2 py-1 text-accent-strong hover:bg-accent-soft"
                          >
                            {t.toTask}
                          </button>
                        ) : (
                          <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{t.hasTask}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmingId(memo.id)}
                          className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
                        >
                          {t.remove}
                        </button>
                      </span>
                    </div>
                    {confirmingId === memo.id && (
                      <div
                        role="alertdialog"
                        aria-label={t.confirmRemove}
                        className="mt-2 rounded-md border border-red-200 bg-red-50 p-3"
                      >
                        <p className="text-sm text-red-800">{t.confirmRemove}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void remove(memo)}
                            className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
                          >
                            {t.confirmRemoveYes}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            className="rounded-md border border-[#dad9d4] bg-white px-3 py-1 text-sm text-[#4a4945]"
                          >
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { IpcError, IpcResult } from '../../shared/ipc'
import type { Memo } from '../../shared/memos/types'
import { MAX_MEMO_LENGTH } from '../../shared/validation/memo'
import { MAX_SEARCH_LENGTH } from '../../shared/validation/memoIpc'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'
import { formatTimestamp } from '../tasks/format'
import { highlightMatches } from './highlight'

const t = ko.memos

const api = () => window.octopus.memos

interface MemosScreenProps {
  /** 검색어 입력을 멈춘 뒤 검색하기까지의 대기 시간 */
  searchDebounceMs?: number
}

/** Ctrl(또는 Cmd)+Enter, 단 한글 조합 중에는 제외 */
function isSaveShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing
}

export function MemosScreen({ searchDebounceMs = 250 }: MemosScreenProps) {
  const [memos, setMemos] = useState<Memo[] | null>(null)
  const [query, setQuery] = useState('')
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string; invalid: boolean } | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const queryRef = useRef(query)
  queryRef.current = query

  /** 지금 검색어에 맞는 목록을 읽는다(검색어가 비어 있으면 전체). */
  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const text = queryRef.current.trim()
    const result = text === '' ? await api().list() : await api().search(text)
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

  async function mutate<R>(run: () => Promise<IpcResult<R>>): Promise<IpcResult<R>> {
    const result = await run()
    if (result.ok) {
      setError(null)
      await load()
    } else if (result.error.code !== 'invalid_input') {
      setError(result.error)
      if (result.error.code === 'not_found') void load()
    }
    return result
  }

  async function saveNew(): Promise<void> {
    if (body.trim() === '') return
    const result = await mutate(() => api().create(body))
    if (result.ok) {
      setBody('')
      setBodyError(false)
    } else if (result.error.code === 'invalid_input') {
      setBodyError(true)
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return
    const result = await mutate(() => api().update(editing.id, editing.text))
    if (result.ok) setEditing(null)
    else if (result.error.code === 'invalid_input') setEditing({ ...editing, invalid: true })
  }

  async function makeTask(memo: Memo): Promise<void> {
    const result = await mutate(() => api().toTask(memo.id))
    setNotice(result.ok ? t.madeTask(result.data.task.title) : null)
  }

  async function remove(memo: Memo): Promise<void> {
    const result = await mutate(() => api().remove(memo.id))
    if (result.ok || result.error.code === 'not_found') setConfirmingId(null)
  }

  const searching = query.trim() !== ''

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50 text-slate-900">
      <header className="space-y-2 border-b border-slate-200 bg-white px-5 py-3">
        <textarea
          value={body}
          rows={3}
          maxLength={MAX_MEMO_LENGTH}
          aria-label={t.newLabel}
          placeholder={t.newPlaceholder}
          onChange={(event) => {
            setBody(event.target.value)
            setBodyError(false)
          }}
          onKeyDown={(event) => {
            if (!isSaveShortcut(event)) return
            event.preventDefault()
            void saveNew()
          }}
          className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
        {bodyError && (
          <p role="alert" className="text-xs text-red-600">
            {t.fieldErrors.body}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={body.trim() === ''}
            onClick={() => void saveNew()}
            className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {t.save}
          </button>
          <span className="text-xs text-slate-500">{t.hint}</span>
          <input
            type="search"
            value={query}
            maxLength={MAX_SEARCH_LENGTH}
            aria-label={t.searchLabel}
            placeholder={t.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            className="ml-auto w-56 rounded-md border border-slate-300 bg-white px-3 py-1 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </header>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 bg-emerald-50 px-5 py-2 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-xs underline">
            {ko.tasks.errors.dismiss}
          </button>
        </div>
      )}

      <section aria-label={t.listLabel} className="flex-1 overflow-y-auto px-5 py-4">
        {!memos ? (
          error ? null : <p className="text-sm text-slate-500">{ko.tasks.loading}</p>
        ) : memos.length === 0 ? (
          <p className="text-sm text-slate-500">{searching ? t.noResults : t.empty}</p>
        ) : (
          <ul className="space-y-3">
            {memos.map((memo) => (
              <li key={memo.id} className={`rounded-lg border bg-white p-3 ${memo.pinned ? 'border-amber-300' : 'border-slate-200'}`}>
                {editing?.id === memo.id ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      value={editing.text}
                      rows={5}
                      maxLength={MAX_MEMO_LENGTH}
                      aria-label={t.editLabel}
                      onChange={(event) => setEditing({ id: memo.id, text: event.target.value, invalid: false })}
                      onKeyDown={(event) => {
                        if (isSaveShortcut(event)) {
                          event.preventDefault()
                          void saveEdit()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditing(null)
                        }
                      }}
                      className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                    />
                    {editing.invalid && (
                      <p role="alert" className="text-xs text-red-600">
                        {t.fieldErrors.body}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit()}
                        className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        {t.save}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
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
                      onClick={() => setEditing({ id: memo.id, text: memo.body, invalid: false })}
                      className="block w-full text-left"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">{searching ? highlightMatches(memo.body, query) : memo.body}</p>
                    </button>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-400">{t.updated(formatTimestamp(memo.updatedAt))}</span>
                      <span className="ml-auto flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void mutate(() => api().togglePin(memo.id))}
                          className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100"
                        >
                          {memo.pinned ? t.unpin : t.pin}
                        </button>
                        {memo.taskId === null ? (
                          <button
                            type="button"
                            onClick={() => void makeTask(memo)}
                            className="rounded px-2 py-1 text-indigo-700 hover:bg-indigo-50"
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
                            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
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

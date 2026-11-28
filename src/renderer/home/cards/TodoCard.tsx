import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError, IpcResult } from '../../../shared/ipc'
import type { Task, TodayView } from '../../../shared/tasks/types'
import { ko } from '../../i18n/ko'
import { errorMessage } from '../../tasks/errors'
import { addedMessage, todayString } from '../../tasks/format'
import { QuickInput } from '../../tasks/QuickInput'
import { viewOf } from '../../../shared/tasks/viewOf'
import { ActionNotice, NOTICE_MS } from '../../ui/ActionNotice'
import { Checkbox } from '../../ui/Checkbox'

const t = ko.home.todo

/** 되돌리기 알림이 떠 있는 시간(ms). 할 일 탭과 같다. */
const UNDO_MS = NOTICE_MS

interface UndoNotice {
  id: string
  title: string
}

interface TodoCardProps {
  /** 날짜가 바뀌면(자정) 목록을 다시 읽는다. */
  dayKey: string
  /** 값이 바뀌면 목록을 다시 읽는다(대화상자에서 할 일을 추가했을 때). */
  refreshKey?: number
  fadeMs: number
  previewDebounceMs: number
  onOpenTasks: () => void
  /** 추가 안내의 [보기]: 그 할 일이 보이는 보기를 열고 선택한다. */
  onOpenTask?: (task: Task) => void
}

/** 오늘 할 일: 지난 할 일 개수 한 줄, 맨 위 빠른 입력, 체크할 수 있는 오늘 목록(루틴 항목 포함). */
export function TodoCard({ dayKey, refreshKey = 0, fadeMs, previewDebounceMs, onOpenTasks, onOpenTask }: TodoCardProps) {
  const [view, setView] = useState<TodayView | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const timers = useRef(new Set<number>())
  const [undo, setUndo] = useState<UndoNotice | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const undoing = useRef(false)
  // 추가했는데 오늘 목록에 안 보이는 할 일의 안내. 되돌리기 알림과 같은 자리에 하나만 뜬다.
  const [added, setAdded] = useState<Task | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const result = await window.octopus.tasks.list('today')
    if (!mounted.current || seq !== loadSeq.current) return
    if (result.ok) setView(result.data)
    else setError(result.error)
  }, [])

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      pending.forEach((timer) => window.clearTimeout(timer))
      window.clearTimeout(undoTimer.current)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, dayKey, refreshKey])

  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  async function quickAdd(text: string): Promise<boolean> {
    const result = await window.octopus.tasks.quickAdd(text)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    await refresh()
    if (mounted.current && viewOf(result.data, todayString()) !== 'today') {
      window.clearTimeout(undoTimer.current)
      setUndo(null)
      setAdded(result.data)
    } else setAdded(null)
    return true
  }

  async function complete(task: Task): Promise<void> {
    const result = await window.octopus.tasks.setStatus(task.id, 'done')
    if (!result.ok) {
      setError(result.error)
      if (result.error.code === 'not_found') void refresh()
      return
    }
    // 잠깐 흐려진 채로 보여 준 뒤 목록을 새로 읽어 사라지게 한다.
    showUndo({ id: task.id, title: task.title })
    setFading((previous) => new Set(previous).add(task.id))
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setFading((previous) => {
        const next = new Set(previous)
        next.delete(task.id)
        return next
      })
      void refresh()
    }, fadeMs)
    timers.current.add(timer)
  }

  /** 되돌리기 알림을 띄운다. 몇 초 뒤 저절로 사라진다. 새 알림이 오면 이전 알림은 밀려난다. */
  function showUndo(next: UndoNotice): void {
    setAdded(null)
    setUndo(next)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }

  /** 체크를 되돌려 다시 미완료로 만든다. 연타해도 요청은 한 번만 나간다. */
  async function runUndo(): Promise<void> {
    if (!undo || undoing.current) return
    undoing.current = true
    const { id } = undo
    window.clearTimeout(undoTimer.current)
    setUndo(null)
    const result: IpcResult<Task> = await window.octopus.tasks
      .setStatus(id, 'open')
      .catch((): IpcResult<Task> => ({ ok: false, error: { code: 'internal' } }))
    undoing.current = false
    if (!mounted.current) return
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setFading((previous) => {
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    await refresh()
  }

  const overdue = view?.overdue.length ?? 0
  const today = view?.today ?? []

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <QuickInput inputRef={inputRef} onSubmit={quickAdd} debounceMs={previewDebounceMs} placeholder={t.inputPlaceholder} />

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {errorMessage(error)}
        </p>
      )}

      {overdue > 0 && (
        <button type="button" onClick={onOpenTasks} className="self-start text-left text-[13px] font-medium text-amber-700 hover:underline">
          {t.overdue(overdue)}
        </button>
      )}

      {view && today.length === 0 ? (
        <p className="text-sm text-[#5e5d58]">{t.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {today.map((task) => (
            <li
              key={task.id}
              className={`flex min-h-10 items-center gap-2.5 border-b border-line transition-opacity duration-300 ${
                fading.has(task.id) ? 'opacity-40' : ''
              }`}
            >
              <Checkbox
                aria-label={`${ko.tasks.complete}: ${task.title}`}
                checked={fading.has(task.id)}
                onChange={() => void complete(task)}
              />
              <button
                type="button"
                onClick={() => onOpenTask?.(task)}
                className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${fading.has(task.id) ? 'text-[#66655f] line-through' : 'text-ink'}`}
              >
                {task.title}
              </button>
              {task.time && <span className="text-xs text-[#5e5d58]">{task.time}</span>}
              {task.routineId !== null && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">{ko.tasks.routineBadge}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {added && (
        <ActionNotice
          key={added.id}
          message={addedMessage(added, todayString())}
          actionLabel={ko.tasks.added.view}
          onAction={() => {
            const task = added
            setAdded(null)
            onOpenTask?.(task)
          }}
          onExpire={() => setAdded(null)}
          className="mt-auto max-w-full self-start"
        />
      )}

      {undo && (
        <div
          role="status"
          className="mt-auto flex max-w-full items-center gap-2.5 self-start rounded-[8px] bg-[#1f1f1d] px-3 py-1.5 text-xs text-[#f6f6f3]"
        >
          <span className="min-w-0 truncate">{ko.tasks.undo.done(undo.title)}</span>
          <button type="button" onClick={() => void runUndo()} className="shrink-0 font-semibold text-[#c9cdf7] hover:underline">
            {ko.tasks.undo.button}
          </button>
        </div>
      )}
    </div>
  )
}

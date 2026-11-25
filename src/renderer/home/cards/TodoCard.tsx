import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError } from '../../../shared/ipc'
import type { Task, TodayView } from '../../../shared/tasks/types'
import { ko } from '../../i18n/ko'
import { errorMessage } from '../../tasks/errors'
import { QuickInput } from '../../tasks/QuickInput'
import { Checkbox } from '../../ui/Checkbox'

const t = ko.home.todo

interface TodoCardProps {
  /** 날짜가 바뀌면(자정) 목록을 다시 읽는다. */
  dayKey: string
  /** 값이 바뀌면 목록을 다시 읽는다(대화상자에서 할 일을 추가했을 때). */
  refreshKey?: number
  fadeMs: number
  previewDebounceMs: number
  onOpenTasks: () => void
}

/** 오늘 할 일: 지난 할 일 개수 한 줄, 맨 위 빠른 입력, 체크할 수 있는 오늘 목록(루틴 항목 포함). */
export function TodoCard({ dayKey, refreshKey = 0, fadeMs, previewDebounceMs, onOpenTasks }: TodoCardProps) {
  const [view, setView] = useState<TodayView | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const timers = useRef(new Set<number>())

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

  const overdue = view?.overdue.length ?? 0
  const today = view?.today ?? []

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <QuickInput inputRef={inputRef} onSubmit={quickAdd} debounceMs={previewDebounceMs} hintOnlyWhileTyping />

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
              <span className={`min-w-0 flex-1 truncate text-sm ${fading.has(task.id) ? 'text-[#66655f] line-through' : 'text-ink'}`}>
                {task.title}
              </span>
              {task.time && <span className="text-xs text-[#5e5d58]">{task.time}</span>}
              {task.routineId !== null && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">{ko.tasks.routineBadge}</span>
              )}
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}

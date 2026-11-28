import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError } from '../../../shared/ipc'
import type { Task, TodayView } from '../../../shared/tasks/types'
import { ko } from '../../i18n/ko'
import { errorMessage } from '../../tasks/errors'
import { addedMessage, todayString } from '../../tasks/format'
import { QuickInput } from '../../tasks/QuickInput'
import { useCompleteWithUndo } from '../../tasks/useCompleteWithUndo'
import { viewOf } from '../../../shared/tasks/viewOf'
import { ActionNotice } from '../../ui/ActionNotice'
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
  /** 추가 안내의 [보기]: 그 할 일이 보이는 보기를 열고 선택한다. */
  onOpenTask?: (task: Task) => void
}

/** 오늘 할 일: 지난 할 일 개수 한 줄, 맨 위 빠른 입력, 체크할 수 있는 오늘 목록(루틴 항목 포함). */
export function TodoCard({ dayKey, refreshKey = 0, fadeMs, previewDebounceMs, onOpenTasks, onOpenTask }: TodoCardProps) {
  const [view, setView] = useState<TodayView | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
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
    return () => {
      mounted.current = false
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
      completion.dismiss()
      setAdded(result.data)
    } else setAdded(null)
    return true
  }

  // 체크·되돌리기는 공용 훅이 맡는다: 바로 줄 긋기 → 흐려진 뒤 목록을 새로 읽어 사라짐, 되돌리기 알림.
  const completion = useCompleteWithUndo({
    settleMs: fadeMs,
    onSaved: async () => {
      setError(null)
      await refresh()
    },
    onFailed: (failure, task) => {
      setError(failure)
      if (failure.code === 'not_found' && task !== null) void refresh()
    },
    onNotice: () => setAdded(null)
  })
  const checked = (id: string): boolean => completion.marks.get(id) === true

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
                checked(task.id) ? 'opacity-40' : ''
              }`}
            >
              <Checkbox
                aria-label={`${ko.tasks.complete}: ${task.title}`}
                checked={checked(task.id)}
                onChange={() => void completion.setChecked(task, true)}
              />
              <button
                type="button"
                onClick={() => onOpenTask?.(task)}
                className={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${checked(task.id) ? 'text-[#66655f] line-through' : 'text-ink'}`}
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
          onExpire={() => setAdded((current) => (current?.id === added.id ? null : current))}
          className="mt-auto max-w-full self-start"
        />
      )}

      {completion.undoNotice('mt-auto max-w-full self-start')}
    </div>
  )
}

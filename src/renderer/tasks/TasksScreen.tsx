import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError, IpcResult } from '../../shared/ipc'
import type { Memo } from '../../shared/memos/types'
import type { TasksApi } from '../../shared/tasks/ipcApi'
import type { Task, TaskFields, TaskView, TodayView } from '../../shared/tasks/types'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'
import { CandidatesSection } from './CandidatesSection'
import { DetailPanel } from './DetailPanel'
import { msUntilNextMidnight, todayString } from './format'
import { OverdueSection } from './OverdueSection'
import { QuickInput } from './QuickInput'
import { Sidebar } from './Sidebar'
import { TaskRow } from './TaskRow'

const t = ko.tasks

interface Lists {
  inbox: Task[]
  today: TodayView
  upcoming: Task[]
  someday: Task[]
  done: Task[]
}

async function loadLists(api: TasksApi): Promise<IpcResult<Lists>> {
  const [inbox, today, upcoming, someday, done] = await Promise.all([
    api.list('inbox'),
    api.list('today'),
    api.list('upcoming'),
    api.list('someday'),
    api.list('done')
  ])
  if (!inbox.ok) return inbox
  if (!today.ok) return today
  if (!upcoming.ok) return upcoming
  if (!someday.ok) return someday
  if (!done.ok) return done
  return {
    ok: true,
    data: { inbox: inbox.data, today: today.data, upcoming: upcoming.data, someday: someday.data, done: done.data }
  }
}

function countsOf(lists: Lists): Record<TaskView, number> {
  return {
    inbox: lists.inbox.length,
    today: lists.today.overdue.length + lists.today.today.length,
    upcoming: lists.upcoming.length,
    someday: lists.someday.length,
    done: lists.done.length
  }
}

function findTask(lists: Lists | null, id: string | null): Task | null {
  if (!lists || id === null) return null
  const all = [...lists.inbox, ...lists.today.overdue, ...lists.today.today, ...lists.upcoming, ...lists.someday, ...lists.done]
  return all.find((task) => task.id === id) ?? null
}

const api = (): TasksApi => window.octopus.tasks

interface TasksScreenProps {
  /** 처음 보여 줄 보기(기본 오늘) */
  initialView?: TaskView
  /** 완료 체크 뒤 목록에서 사라지기까지 흐려지는 시간 */
  fadeMs?: number
  /** 입력을 멈춘 뒤 미리보기를 요청하기까지의 대기 시간 */
  previewDebounceMs?: number
}

export function TasksScreen({ initialView, fadeMs = 350, previewDebounceMs = 250 }: TasksScreenProps) {
  const [view, setView] = useState<TaskView>(initialView ?? 'today')
  const [lists, setLists] = useState<Lists | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [dayTick, setDayTick] = useState(0)
  const [linkedMemo, setLinkedMemo] = useState<Memo | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const timers = useRef(new Set<number>())

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const result = await loadLists(api())
    if (!mounted.current || seq !== loadSeq.current) return
    if (result.ok) setLists(result.data)
    else setError(result.error)
  }, [])

  useEffect(() => {
    mounted.current = true
    const pendingTimers = timers.current
    void refresh()
    return () => {
      mounted.current = false
      pendingTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [refresh])

  // 열어 둔 할 일에 연결된 메모가 있으면 상세 패널에 보여 주려고 찾는다.
  useEffect(() => {
    if (selectedId === null) {
      setLinkedMemo(null)
      return
    }
    let cancelled = false
    void window.octopus.memos.list().then((result) => {
      if (!cancelled) setLinkedMemo(result.ok ? (result.data.find((memo) => memo.taskId === selectedId) ?? null) : null)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // 창이 다시 포커스될 때 목록을 새로고침한다.
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // 자정이 지나면 "오늘"이 바뀌므로 새로고침한다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
      setDayTick((tick) => tick + 1)
    }, msUntilNextMidnight(new Date()) + 1000)
    return () => window.clearTimeout(timer)
  }, [dayTick, refresh])

  // N 또는 / 로 빠른 입력창에 포커스(입력 중일 때는 무시)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const wanted = event.code === 'KeyN' || event.key === 'n' || event.key === 'N' || event.key === '/'
      if (!wanted) return
      const target = event.target as HTMLElement | null
      const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      if (typing) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function fail(failure: IpcError): void {
    setError(failure)
    if (failure.code === 'not_found') void refresh()
  }

  async function toggle(task: Task): Promise<void> {
    const nextChecked = !(pending.get(task.id) ?? task.status === 'done')
    const result = await api().setStatus(task.id, nextChecked ? 'done' : 'open')
    if (!result.ok) return fail(result.error)

    // 잠깐 흐려진 채로 보여 준 뒤 목록을 새로고침해 사라지게 한다.
    setPending((previous) => new Map(previous).set(task.id, nextChecked))
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setPending((previous) => {
        const next = new Map(previous)
        next.delete(task.id)
        return next
      })
      void refresh()
    }, fadeMs)
    timers.current.add(timer)
  }

  async function quickAdd(text: string): Promise<boolean> {
    const result = await api().quickAdd(text)
    if (!result.ok) {
      fail(result.error)
      return false
    }
    setError(null)
    await refresh()
    return true
  }

  async function moveTasks(run: () => Promise<IpcResult<Task[]>>): Promise<boolean> {
    const result = await run()
    if (!result.ok) {
      fail(result.error)
      return false
    }
    setError(null)
    await refresh()
    return true
  }

  async function saveDetail(id: string, patch: Partial<TaskFields>): Promise<IpcResult<Task>> {
    const result = await api().update(id, patch)
    if (result.ok) {
      setError(null)
      setSelectedId(null)
      await refresh()
    } else if (result.error.code !== 'invalid_input') {
      fail(result.error)
    }
    return result
  }

  async function removeTask(id: string): Promise<void> {
    const result = await api().remove(id)
    // 이미 없는 할 일(not_found)을 지우려던 것이면 목적은 이룬 셈이라 조용히 닫는다.
    if (!result.ok && result.error.code !== 'not_found') return fail(result.error)
    setError(null)
    setSelectedId(null)
    await refresh()
  }

  const today = todayString()
  const selectedTask = findTask(lists, selectedId)
  const counts = lists ? countsOf(lists) : null

  function renderRows(tasks: Task[]) {
    return (
      <ul aria-label={t.listLabel}>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            checked={pending.get(task.id) ?? task.status === 'done'}
            fading={pending.has(task.id)}
            active={task.id === selectedId}
            onToggle={() => void toggle(task)}
            onOpen={() => setSelectedId(task.id)}
          />
        ))}
      </ul>
    )
  }

  function renderContent() {
    if (!lists) return error ? null : <p className="text-sm text-slate-500">{t.loading}</p>

    if (view === 'today') {
      const { overdue, today: dueToday } = lists.today
      if (overdue.length === 0 && dueToday.length === 0) return <p className="text-sm text-slate-500">{t.empty.today}</p>
      return (
        <>
          {overdue.length > 0 && (
            <OverdueSection
              tasks={overdue}
              today={today}
              activeId={selectedId}
              pending={pending}
              onToggle={(task) => void toggle(task)}
              onOpen={(task) => setSelectedId(task.id)}
              onMoveToToday={(ids) => moveTasks(() => api().moveToToday(ids))}
              onMoveToSomeday={(ids) => moveTasks(() => api().moveToSomeday(ids))}
              onReschedule={(ids, date) => moveTasks(() => api().reschedule(ids, date))}
            />
          )}
          {dueToday.length > 0 && (
            <section aria-label={t.todaySection}>
              <h2 className="mb-1 text-sm font-semibold text-slate-600">{t.todaySection}</h2>
              {renderRows(dueToday)}
            </section>
          )}
        </>
      )
    }

    const tasks = lists[view]
    if (tasks.length === 0) return <p className="text-sm text-slate-500">{t.empty[view]}</p>
    return renderRows(tasks)
  }

  return (
    <div className="flex h-full bg-slate-50 text-slate-900">
      <Sidebar view={view} counts={counts} onSelect={setView} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-5 py-3">
          <QuickInput inputRef={inputRef} onSubmit={quickAdd} debounceMs={previewDebounceMs} />
        </header>

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <section aria-label={t.views[view]} className="flex-1 overflow-y-auto px-5 py-4">
          <h1 className="mb-3 text-lg font-semibold">{t.views[view]}</h1>
          {view === 'inbox' && <CandidatesSection onChanged={() => void refresh()} />}
          {renderContent()}
        </section>
      </main>

      {selectedTask && (
        <DetailPanel
          key={selectedTask.id}
          task={selectedTask}
          linkedMemo={linkedMemo}
          onSave={(patch) => saveDetail(selectedTask.id, patch)}
          onRemove={() => removeTask(selectedTask.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

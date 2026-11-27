import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError, IpcResult } from '../../shared/ipc'
import type { Memo } from '../../shared/memos/types'
import type { TasksApi } from '../../shared/tasks/ipcApi'
import { localDateString } from '../../shared/tasks/dates'
import type { Task, TaskFields, TaskView, TodayView } from '../../shared/tasks/types'
import { ErrorBanner } from '../ErrorBanner'
import { useDataChanged } from '../dataEvents'
import { useLeaveGuard, UnsavedStrip } from '../leaveGuard'
import { safeInvoke } from '../safeInvoke'
import { ko } from '../i18n/ko'
import { CandidatesSection } from './CandidatesSection'
import { DetailPanel } from './DetailPanel'
import { dayHeading, formatClock, formatHomeDate, msUntilNextMidnight, todayString } from './format'
import { OverdueSection } from './OverdueSection'
import { QuickInput } from './QuickInput'
import { Sidebar } from './Sidebar'
import { TaskRow } from './TaskRow'

const t = ko.tasks

/** 되돌리기 알림이 떠 있는 시간(ms) */
const UNDO_MS = 6000

interface Lists {
  inbox: Task[]
  today: TodayView
  upcoming: Task[]
  someday: Task[]
  done: Task[]
}

interface Undo {
  message: string
  restore: () => Promise<IpcResult<Task>>
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

/** 같은 키가 이어지는 항목끼리 묶는다(정렬된 목록이라 이어지는 것만 묶으면 된다). */
function groupBy(tasks: Task[], keyOf: (task: Task) => string): { key: string; items: Task[] }[] {
  const groups: { key: string; items: Task[] }[] = []
  for (const task of tasks) {
    const key = keyOf(task)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(task)
    else groups.push({ key, items: [task] })
  }
  return groups
}

const api = (): TasksApi => window.octopus.tasks

const GROUP_HEADING = 'mb-1 mt-2 text-[13px] font-semibold text-[#4A4945]'

interface TasksScreenProps {
  /** 처음 보여 줄 보기(기본 오늘) */
  initialView?: TaskView
  /** 완료 체크 뒤 목록에서 사라지기까지 흐려지는 시간 */
  fadeMs?: number
  /** 입력을 멈춘 뒤 미리보기를 요청하기까지의 대기 시간 */
  previewDebounceMs?: number
  /** 개발용 캡처: 처음 목록이 열리면 반복 할 일(없으면 첫 할 일)의 상세 패널을 연다. */
  openFirst?: boolean
}

export function TasksScreen({ initialView, fadeMs = 350, previewDebounceMs = 250, openFirst = false }: TasksScreenProps) {
  const [view, setView] = useState<TaskView>(initialView ?? 'today')
  const [lists, setLists] = useState<Lists | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [dayTick, setDayTick] = useState(0)
  const [linkedMemo, setLinkedMemo] = useState<Memo | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  /** 상세 패널에서 저장하지 않은 고침이 있는지(패널이 알려 준다). */
  const [detailDirty, setDetailDirty] = useState(false)
  /** 쓰던 상세 편집이 있을 때 다른 할 일로 옮기기 전에 묻는다. 값은 옮긴 뒤 할 일. */
  const [askLeave, setAskLeave] = useState<{ run: () => void } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)
  const timers = useRef(new Set<number>())
  const undoTimer = useRef<number | undefined>(undefined)
  const autoOpened = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const result = await safeInvoke(() => loadLists(api()))
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
      window.clearTimeout(undoTimer.current)
    }
  }, [refresh])

  // 열어 둔 할 일에 연결된 메모가 있으면 상세 패널에 보여 주려고 찾는다.
  useEffect(() => {
    if (selectedId === null) {
      setLinkedMemo(null)
      return
    }
    let cancelled = false
    void safeInvoke(() => window.octopus.memos.list()).then((result) => {
      if (!cancelled) setLinkedMemo(result.ok ? (result.data.find((memo) => memo.taskId === selectedId) ?? null) : null)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // 개발용 캡처: 처음 목록이 오면 상세 패널을 한 번 연다.
  useEffect(() => {
    if (!openFirst || autoOpened.current || !lists) return
    autoOpened.current = true
    const candidates = [...lists.today.overdue, ...lists.today.today]
    const pick = candidates.find((task) => task.repeat !== null) ?? candidates[0]
    if (pick) setSelectedId(pick.id)
  }, [openFirst, lists])

  // 데이터가 바뀌면(지시하기 등) 목록만 다시 읽는다. 상세 편집·입력 글은 그대로 둔다.
  useDataChanged(() => void refresh())

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

  /** 상세 패널을 다른 할 일로 바꾸거나 닫는다. 고친 내용이 있으면 먼저 묻는다(계속 쓰기 / 버리기). */
  function requestSelect(id: string | null): void {
    if (id === selectedId) return
    const move = (): void => {
      setDetailDirty(false)
      setSelectedId(id)
    }
    if (detailDirty && selectedTask !== null) setAskLeave({ run: move })
    else move()
  }

  function fail(failure: IpcError): void {
    setError(failure)
    if (failure.code === 'not_found') void refresh()
  }

  /** 되돌리기 알림을 띄운다. 몇 초 뒤 저절로 사라진다. */
  function showUndo(next: Undo): void {
    setUndo(next)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
  }

  async function runUndo(): Promise<void> {
    if (!undo) return
    const { restore } = undo
    setUndo(null)
    window.clearTimeout(undoTimer.current)
    const result = await restore()
    if (!result.ok) return fail(result.error)
    setError(null)
    await refresh()
  }

  async function toggle(task: Task): Promise<void> {
    const nextChecked = !(pending.get(task.id) ?? task.status === 'done')
    const result = await api().setStatus(task.id, nextChecked ? 'done' : 'open')
    if (!result.ok) return fail(result.error)
    if (nextChecked) showUndo({ message: t.undo.done(task.title), restore: () => api().setStatus(task.id, 'open') })

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

  /** 취소: 목록에서만 사라지고 지워지지는 않는다. 되돌리면 다시 연다. */
  async function cancelTask(task: Task): Promise<void> {
    const result = await api().setStatus(task.id, 'canceled')
    if (!result.ok) return fail(result.error)
    setError(null)
    setSelectedId(null)
    showUndo({ message: t.undo.canceled(task.title), restore: () => api().setStatus(task.id, 'open') })
    await refresh()
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
  const detailShown = selectedTask !== null
  // 패널이 사라지면(취소·삭제·목록에서 빠짐) 고침 표시도 함께 지운다. 패널이 보일 때만 떠나기 보호에 등록한다.
  useEffect(() => {
    if (!detailShown) setDetailDirty(false)
  }, [detailShown])
  useLeaveGuard(detailShown && detailDirty)

  function renderRows(tasks: Task[], doneLabelOf?: (task: Task) => string | undefined) {
    return (
      <ul aria-label={t.listLabel} className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            checked={pending.get(task.id) ?? task.status === 'done'}
            fading={pending.has(task.id)}
            active={task.id === selectedId}
            onToggle={() => void toggle(task)}
            onOpen={() => requestSelect(task.id)}
            doneLabel={doneLabelOf?.(task)}
          />
        ))}
      </ul>
    )
  }

  /** 날짜별로 묶어 머리글을 붙인다(예정·완료). */
  function renderGrouped(tasks: Task[], keyOf: (task: Task) => string, doneLabelOf?: (task: Task) => string | undefined) {
    return groupBy(tasks, keyOf).map((group) => {
      const heading = group.key === '' ? t.views[view] : dayHeading(group.key, today)
      return (
        <section key={group.key} aria-label={heading}>
          <h2 className={GROUP_HEADING}>
            {heading} <span className="font-normal text-[#5E5D58]">{group.items.length}</span>
          </h2>
          {renderRows(group.items, doneLabelOf)}
        </section>
      )
    })
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
              onOpen={(task) => requestSelect(task.id)}
              onMoveToToday={(ids) => moveTasks(() => api().moveToToday(ids))}
              onMoveToSomeday={(ids) => moveTasks(() => api().moveToSomeday(ids))}
              onReschedule={(ids, date) => moveTasks(() => api().reschedule(ids, date))}
            />
          )}
          {dueToday.length > 0 && (
            <section aria-label={t.todaySection}>
              <h2 className={GROUP_HEADING}>{t.todaySection}</h2>
              {renderRows(dueToday)}
            </section>
          )}
        </>
      )
    }

    if (view === 'upcoming') {
      if (lists.upcoming.length === 0) return <p className="text-sm text-slate-500">{t.empty.upcoming}</p>
      return renderGrouped(lists.upcoming, (task) => task.date ?? '')
    }

    if (view === 'done') {
      if (lists.done.length === 0) return <p className="text-sm text-slate-500">{t.empty.done}</p>
      const doneDay = (task: Task): string => (task.doneAt ? localDateString(new Date(task.doneAt)) : '')
      const doneLabel = (task: Task): string | undefined => (task.doneAt ? t.doneAt(formatClock(task.doneAt)) : undefined)
      return renderGrouped(lists.done, doneDay, doneLabel)
    }

    const tasks = lists[view]
    if (tasks.length === 0) return <p className="text-sm text-slate-500">{t.empty[view]}</p>
    return renderRows(tasks)
  }

  const subtitle = view === 'today' ? formatHomeDate(new Date()) : t.subtitles[view]
  const hint = view === 'today' ? null : (t.hints[view] ?? null)

  return (
    <div className="relative flex h-full bg-[#F6F6F3] text-ink">
      <Sidebar view={view} counts={counts} onSelect={setView} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="px-8 pb-2 pt-6">
          <QuickInput inputRef={inputRef} onSubmit={quickAdd} debounceMs={previewDebounceMs} />
        </header>

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {askLeave && (
          <div className="px-8">
            <UnsavedStrip
              title={ko.home.localCalendar.editDiscardTitle}
              onKeep={() => setAskLeave(null)}
              onDiscard={() => {
                const { run } = askLeave
                setAskLeave(null)
                run()
              }}
            />
          </div>
        )}

        <section aria-label={t.views[view]} className="flex-1 overflow-y-auto px-8 pb-8 pt-2">
          <div className="mb-1 flex flex-wrap items-baseline gap-3">
            <h1 className="text-[28px] font-bold leading-tight">{t.views[view]}</h1>
            <span className="text-sm text-[#5E5D58]">{subtitle}</span>
          </div>
          {hint && <p className="mb-3 text-xs text-[#5E5D58]">{hint}</p>}
          {view === 'inbox' && <CandidatesSection onChanged={() => void refresh()} />}
          {renderContent()}
        </section>

        {undo && (
          <div role="status" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[10px] bg-[#1f1f1d] px-4 py-3 text-sm text-[#f6f6f3]">
            <span>{undo.message}</span>
            <button type="button" onClick={() => void runUndo()} className="font-semibold text-[#c9cdf7] hover:underline">
              {t.undo.button}
            </button>
          </div>
        )}
      </main>

      {selectedTask && (
        <DetailPanel
          key={selectedTask.id}
          task={selectedTask}
          linkedMemo={linkedMemo}
          onSave={(patch) => saveDetail(selectedTask.id, patch)}
          onRemove={() => removeTask(selectedTask.id)}
          onCancel={() => cancelTask(selectedTask)}
          onClose={() => requestSelect(null)}
          onDirtyChange={setDetailDirty}
        />
      )}
    </div>
  )
}

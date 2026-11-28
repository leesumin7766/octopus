import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react'
import { groupDayTasks } from '../../../shared/calendar/day'
import type { CalendarEvent, CalendarToday } from '../../../shared/calendar/types'
import type { IpcResult } from '../../../shared/ipc'
import { addDays } from '../../../shared/tasks/dates'
import type { QuickParseOptions } from '../../../shared/tasks/quickParse'
import type { Task, TaskFields } from '../../../shared/tasks/types'
import { notifyDataChanged } from '../../dataEvents'
import { ko } from '../../i18n/ko'
import { useLeaveGuard } from '../../leaveGuard'
import { safeInvoke } from '../../safeInvoke'
import { DetailPanel } from '../../tasks/DetailPanel'
import { errorMessage } from '../../tasks/errors'
import { QuickInput } from '../../tasks/QuickInput'
import { useCompleteWithUndo } from '../../tasks/useCompleteWithUndo'
import { Checkbox } from '../../ui/Checkbox'
import { Icon } from '../../ui/Icon'
import { formatDayTitle } from './format'
import { useTasksInRange } from './useTasksInRange'

const t = ko.home.dialogs
const c = ko.home.calendar
const m = ko.home.localCalendar

const PREVIEW_DEBOUNCE_MS = 250

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const pad = (n: number): string => String(n).padStart(2, '0')
const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 작성 중인 내용이 있을 때 나가려던 곳. 확인 후에만 실행한다. */
type Leave = { kind: 'close' } | { kind: 'move'; to: string } | { kind: 'edit'; id: string } | { kind: 'leaveEdit' }

interface DayDialogProps {
  /** 처음 보일 날짜(YYYY-MM-DD). 이후 날짜는 대화상자 안에서 옮긴다. */
  startDate: string
  /** 대화상자 안에서 날짜를 옮기면 알린다(선택 표시를 같이 옮긴다). */
  onDateChange: (date: string) => void
  /** 오늘(로컬 날짜) */
  today: string
  /** 지금 시각(진행 중 일정 표시) */
  now: Date
  /** Google 상태(없으면 null). 오늘 날짜일 때만 Google 일정 영역을 보인다. */
  calendar: CalendarToday | null
  /** 홈의 갱신 신호와 오늘 날짜가 바뀌면 다시 읽는다 */
  refreshKey: number
  onClose: () => void
  onReconnect: () => void
  onOpenEvent: (id: string) => void
  /** dialog: 홈의 큰 대화상자(기본). panel: 달력 화면 오른쪽에 붙어 있는 날짜 상세(닫기·포커스 가두기 없음) */
  variant?: 'dialog' | 'panel'
  /**
   * 달력 화면(panel)이 Google 일정의 상태를 더 자세히 보여 달라고 할 때만 준다. 없으면(홈) 연결하지 않았거나 읽는 중이면 아무것도 쓰지 않는다.
   * loading: 처음 읽는 중 / readFailed: 읽지 못함([다시 시도]) / showDisconnected: 연결 안 됨([연결하기])
   */
  google?: { loading: boolean; readFailed: boolean; onRetry: () => void; showDisconnected: boolean }
  /** panel 에서 달력 칸을 눌렀을 때 날짜를 옮긴다(작성 중이면 먼저 묻는다) */
  handleRef?: Ref<DayViewHandle>
}

export interface DayViewHandle {
  goTo(date: string): void
}

/**
 * 날짜 상세(큰 대화상자). 선택한 날짜의 할 일을 보고, 추가·완료·편집할 수 있다.
 * - 추가는 선택한 날짜로 명시해서 저장한다(제목 안의 '내일' 같은 말로 날짜를 바꾸지 않는다).
 * - 작성·편집 중인 내용이 있으면 닫기·Esc·배경 클릭·날짜 이동 전에 확인한다.
 * - 저장 중에는 날짜를 옮기거나 닫지 못한다. 같은 저장 요청은 한 번만 보낸다.
 * - 저장한 결과는 알림으로 홈 전체에 알려 달력·오늘 카드·목록이 같은 값을 보게 한다. 홈은 다시 그리지 않는다.
 * 열 때 누른 칸으로 포커스를 돌려주고, 대화상자 안에서만 Tab 이 돈다.
 */
export function DayDialog({ startDate, onDateChange, today, now, calendar, refreshKey, onClose, onReconnect, onOpenEvent, google, variant = 'dialog', handleRef }: DayDialogProps) {
  const isPanel = variant === 'panel'
  const [date, setDate] = useState(startDate)
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(true)
  const { state, retry } = useTasksInRange(date, date, `${refreshKey}|${today}`)

  // 추가 입력
  // 입력칸(QuickInput)이 글·시각을 들고 있다. 여기서는 쓰던 내용이 있는지만 안다. resetKey 를 바꾸면 입력칸이 비워진다.
  const [addDirty, setAddDirty] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const addInputRef = useRef<HTMLInputElement>(null)
  const [addStatus, setAddStatus] = useState<'idle' | 'saving' | 'failed' | 'saved'>('idle')
  const [addError, setAddError] = useState<string | null>(null)
  const addInFlight = useRef(false)

  // 완료 표시
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)

  // 편집
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDirty, setEditDirty] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // 확인 질문과 알림
  const [leaving, setLeaving] = useState<Leave | null>(null)
  const keepWritingRef = useRef<HTMLButtonElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const busy = addStatus === 'saving' || editSaving
  const dirty = addDirty || (editingId !== null && editDirty)
  // 작성 중이거나 편집 중인 내용이 있으면 화면을 옮기기 전에 묻는다.
  useLeaveGuard(dirty)

  useEffect(() => {
    mounted.current = true
    // 대화상자만 열 때 제목으로 포커스를 옮기고, 닫으면 누른 칸으로 돌려준다(달력 화면의 패널은 포커스를 건드리지 않는다).
    const returnTo = !isPanel && document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!isPanel) titleRef.current?.focus()
    return () => {
      mounted.current = false
      if (returnTo && returnTo.isConnected) returnTo.focus()
    }
  }, [isPanel])

  useEffect(() => {
    if (leaving !== null) keepWritingRef.current?.focus()
  }, [leaving])

  // 체크·되돌리기는 공용 훅이 맡는다: 바로 줄 긋기, 목록에 남음, 되돌리기 알림(다시 눌러 해제해도 된다).
  const completion = useCompleteWithUndo({
    autoClear: false, // 목록을 다시 읽은 뒤(아래 reconcile) 표시를 거둔다
    onSaved: () => notifyDataChanged(),
    onFailed: (failure, task) => {
      if (task !== null) setRowError({ id: task.id, text: m.rowFailed })
      else setNotice(m.rowFailed)
    }
  })

  // 목록을 다시 읽으면 줄 긋기 표시를 거둔다(목록이 이미 같은 상태를 보이거나, 읽지 못했을 때).
  const { reconcile } = completion
  useEffect(() => {
    if (state.status === 'ready') reconcile(state.tasks)
    else if (state.status === 'error') reconcile(null)
  }, [state, reconcile])

  // 편집 중인 할 일이 목록에서 사라졌으면(다른 곳에서 바뀌었거나 날짜가 옮겨졌으면) 편집을 닫는다.
  useEffect(() => {
    if (editingId === null || state.status !== 'ready') return
    if (!state.tasks.some((task) => task.id === editingId)) {
      setEditingId(null)
      setEditDirty(false)
    }
  }, [editingId, state])

  function clearDraft(): void {
    setResetKey((key) => key + 1)
    setAddDirty(false)
  }

  function moveTo(next: string): void {
    setDate(next)
    onDateChange(next)
    setEditingId(null)
    setEditDirty(false)
    setEditError(null)
    setRowError(null)
  }

  /** 실제로 나가거나 옮긴다(확인이 끝난 뒤). */
  function perform(next: Leave): void {
    switch (next.kind) {
      case 'close':
        return onClose()
      case 'move':
        return moveTo(next.to)
      case 'edit':
        setEditingId(next.id)
        setEditDirty(false)
        setEditError(null)
        return
      case 'leaveEdit':
        setEditingId(null)
        setEditDirty(false)
        setEditError(null)
        return
    }
  }

  /** 나가기·옮기기·편집 열기 요청. 작성 중이면 먼저 묻는다. 저장 중이면 막는다. */
  function request(next: Leave): void {
    if (busy) {
      setNotice(m.busyNav)
      return
    }
    if (dirty) {
      setLeaving(next)
      return
    }
    perform(next)
  }

  useImperativeHandle(handleRef, () => ({
    goTo: (next: string) => {
      if (next !== date) request({ kind: 'move', to: next })
    }
  }))

  /** 확인에서 "버리기": 잃는 내용만 지운 뒤 나간다. 편집만 닫는 경우에는 추가 입력을 지우지 않는다. */
  function discardAndLeave(next: Leave): void {
    setLeaving(null)
    if (next.kind !== 'leaveEdit' && next.kind !== 'edit') clearDraft()
    setEditDirty(false)
    perform(next)
  }

  /** 입력칸의 추가. true 를 돌려주면 입력칸이 비워진다. 실패하면 입력은 그대로 둔다. */
  async function addTask(text: string, options?: QuickParseOptions): Promise<boolean> {
    if (text.trim() === '' || addInFlight.current || busy) return false
    addInFlight.current = true
    const day = date // 저장 날짜는 누른 순간의 선택 날짜로 고정한다(문장에 날짜가 있으면 문장이 이긴다)
    setAddStatus('saving')
    setAddError(null)
    const result = await safeInvoke(() => window.octopus.tasks.quickAdd(text, { ...options, defaultDate: day }))
    addInFlight.current = false
    if (!mounted.current) return false
    if (result.ok) {
      setAddStatus('saved')
      notifyDataChanged()
      return true
    }
    setAddStatus('failed')
    setAddError(m.addFailed)
    return false
  }

  function toggle(task: Task): void {
    if (busy) return
    setRowError(null)
    const shown = completion.marks.get(task.id) ?? task.status === 'done'
    void completion.setChecked(task, !shown)
  }

  async function saveEdit(id: string, patch: Partial<TaskFields>): Promise<IpcResult<Task>> {
    setEditSaving(true)
    setEditError(null)
    const result = await safeInvoke(() => window.octopus.tasks.update(id, patch))
    if (!mounted.current) return result
    setEditSaving(false)
    if (result.ok) {
      setEditingId(null)
      setEditDirty(false)
      if (result.data.date === null) setNotice(m.movedAway)
      else if (result.data.date !== date) setNotice(m.movedNotice(formatDayTitle(result.data.date, today)))
      else setNotice(m.editSaved)
      notifyDataChanged()
    } else if (result.error.code !== 'invalid_input') {
      setEditError(errorMessage(result.error) || m.editFailed)
    }
    return result
  }

  async function removeEdit(id: string): Promise<void> {
    const result = await safeInvoke(() => window.octopus.tasks.remove(id))
    if (!mounted.current) return
    if (!result.ok && result.error.code !== 'not_found') {
      setEditError(m.removeFailed)
      return
    }
    setEditingId(null)
    setEditDirty(false)
    notifyDataChanged()
  }

  /** 편집 창의 '안 하기': 할 일을 안 하기 상태로 바꾼다(지우지 않는다). 날짜 목록에서는 그 항목이 빠진다. */
  async function cancelEdit(id: string): Promise<void> {
    const result = await safeInvoke(() => window.octopus.tasks.setStatus(id, 'canceled'))
    if (!mounted.current) return
    if (!result.ok && result.error.code !== 'not_found') {
      setEditError(m.cancelFailed)
      return
    }
    setEditingId(null)
    setEditDirty(false)
    notifyDataChanged()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (leaving !== null) {
        setLeaving(null)
        return
      }
      // 편집 중에는 편집 창이 Esc 를 처리한다(편집 닫기). 패널은 닫을 것이 없다.
      if (editingId !== null || isPanel) return
      request({ kind: 'close' })
      return
    }
    if (event.key !== 'Tab' || isPanel) return

    // 대화상자 안의 조작 칸만 돈다. 제목(포커스 가능하지만 Tab 칸은 아님)에서 Shift+Tab 은 마지막 칸으로.
    const dialog = dialogRef.current
    const items = dialog ? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)] : []
    if (!dialog || items.length === 0) {
      event.preventDefault()
      return
    }
    const active = document.activeElement
    const inside = dialog.contains(active)
    if (event.shiftKey) {
      if (!inside || active === items[0] || active === titleRef.current) {
        event.preventDefault()
        items[items.length - 1].focus()
      }
    } else if (!inside || active === items[items.length - 1]) {
      event.preventDefault()
      items[0].focus()
    }
  }

  const isToday = date === today
  const shiftDay = (days: number): void => request({ kind: 'move', to: addDays(date, days) })
  const editing = editingId === null || state.status !== 'ready' ? undefined : state.tasks.find((task) => task.id === editingId)

  const navButton = 'flex size-8 items-center justify-center rounded-lg text-[#5e5d58] hover:bg-black/5 disabled:opacity-40'
  const header = (
    <header className="flex items-center gap-1 border-b border-line px-4 py-3">
      <button type="button" aria-label={m.prevDay} title={m.prevDay} disabled={busy} onClick={() => shiftDay(-1)} className={navButton}>
        <Icon name="prev" size={18} />
      </button>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 text-center text-base font-bold outline-none [overflow-wrap:anywhere]">
        {formatDayTitle(date, today)}
      </h2>
      <button type="button" aria-label={m.nextDay} title={m.nextDay} disabled={busy} onClick={() => shiftDay(1)} className={navButton}>
        <Icon name="next" size={18} />
      </button>
      {!isPanel && (
        <button type="button" aria-label={t.close} title={t.close} onClick={() => request({ kind: 'close' })} className={`${navButton} ml-1`}>
          <Icon name="close" size={18} />
        </button>
      )}
    </header>
  )

  const body = (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {leaving !== null && (
            <div role="group" aria-label={leaving.kind === 'leaveEdit' || editingId !== null ? m.editDiscardTitle : m.discardTitle} className="mb-4 rounded-lg border border-[#e7c9bf] bg-[#fbeee9] p-3">
              <p className="mb-2 text-sm text-[#7d2a21]">{leaving.kind === 'leaveEdit' || editingId !== null ? m.editDiscardTitle : m.discardTitle}</p>
              <div className="flex flex-wrap gap-2">
                <button ref={keepWritingRef} type="button" onClick={() => setLeaving(null)} className="min-h-8 rounded-lg border border-line bg-white px-3 text-sm hover:bg-black/5">
                  {m.discardNo}
                </button>
                <button type="button" onClick={() => discardAndLeave(leaving)} className="min-h-8 rounded-lg bg-[#7d2a21] px-3 text-sm font-semibold text-white">
                  {m.discardYes}
                </button>
              </div>
            </div>
          )}

          <div hidden={editing !== undefined}>
            <AddForm
              inputRef={addInputRef}
              date={date}
              resetKey={resetKey}
              status={addStatus}
              error={addError}
              onDirtyChange={setAddDirty}
              onSubmit={addTask}
              onEdited={() => {
                if (addStatus !== 'saving') setAddStatus('idle')
              }}
            />
          </div>

          {editing !== undefined ? (
            <div className="flex flex-col gap-2">
              {editError && (
                <p role="alert" className="text-sm text-[#7d2a21]">
                  {editError}
                </p>
              )}
              <DetailPanel
                key={editing.id}
                task={editing}
                onSave={(patch) => saveEdit(editing.id, patch)}
                onRemove={() => removeEdit(editing.id)}
                onCancel={() => cancelEdit(editing.id)}
                onClose={() => request({ kind: 'leaveEdit' })}
                onDirtyChange={setEditDirty}
              />
            </div>
          ) : (
            <>
              {notice && (
                <p role="status" className="mb-2 text-sm text-accent-strong">
                  {notice}
                </p>
              )}
              {completion.undoNotice('mb-2 self-start')}
              <LocalTasks
                marks={completion.marks}
                state={state}
                today={today}
                onRetry={retry}
                onToggle={(task) => void toggle(task)}
                onEdit={(task) => request({ kind: 'edit', id: task.id })}
                rowError={rowError}
              />
            </>
          )}

          {isToday && <GoogleToday calendar={calendar} now={now} onReconnect={onReconnect} onOpenEvent={onOpenEvent} google={google} />}
        </div>
  )

  if (isPanel) {
    return (
      <section aria-labelledby={titleId} onKeyDown={onKeyDown} className="flex min-h-0 flex-col rounded-2xl border border-line bg-white">
        {header}
        {body}
      </section>
    )
  }

  return (
    <div
      className="app-no-drag fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) request({ kind: 'close' })
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="flex max-h-[min(680px,calc(100vh-48px))] w-[min(560px,100%)] flex-col rounded-2xl bg-white shadow-xl"
      >
        {header}
        {body}
      </div>
    </div>
  )
}

function AddForm({
  inputRef,
  date,
  resetKey,
  status,
  error,
  onDirtyChange,
  onSubmit,
  onEdited
}: {
  inputRef: RefObject<HTMLInputElement | null>
  date: string
  resetKey: number
  status: 'idle' | 'saving' | 'failed' | 'saved'
  error: string | null
  onDirtyChange: (dirty: boolean) => void
  onSubmit: (text: string, options?: QuickParseOptions) => Promise<boolean>
  onEdited: () => void
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 border-b border-line pb-4" onChange={onEdited}>
      <QuickInput
        key={resetKey}
        inputRef={inputRef}
        debounceMs={PREVIEW_DEBOUNCE_MS}
        placeholder={m.addPlaceholder}
        label={m.addLabel}
        defaultDate={date}
        showTimeField
        onDirtyChange={onDirtyChange}
        onSubmit={onSubmit}
      />
      {status === 'failed' && error && (
        <p role="alert" className="text-sm text-[#7d2a21]">
          {error}
        </p>
      )}
    </div>
  )
}

type RangeStateView = { status: 'loading' } | { status: 'ready'; tasks: Task[] } | { status: 'error' }

function LocalTasks({
  marks,
  state,
  today,
  onRetry,
  onToggle,
  onEdit,
  rowError
}: {
  marks: ReadonlyMap<string, boolean>
  state: RangeStateView
  today: string
  onRetry: () => void
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  rowError: { id: string; text: string } | null
}) {
  if (state.status === 'loading') return <p className="text-sm text-[#5e5d58]">{m.loading}</p>
  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-[#7d2a21]">
          {m.loadFailed}
        </p>
        <button type="button" onClick={onRetry} className="min-h-8 rounded-lg border border-line bg-white px-3 text-sm hover:bg-black/5">
          {m.retry}
        </button>
      </div>
    )
  }
  if (state.tasks.length === 0) return <p className="text-sm text-[#5e5d58]">{m.emptyDay}</p>

  const { timed, untimed } = groupDayTasks(state.tasks)
  const list = (label: string, tasks: Task[], showTime: boolean) => (
    <section>
      <ul aria-label={label} className="flex flex-col gap-0.5">
        {tasks.map((task) => {
          const done = marks.get(task.id) ?? task.status === 'done'
          const overdue = !done && task.date !== null && task.date < today
          return (
            <li key={task.id} className="group flex flex-wrap items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/[0.03]">
              <span className="pt-0.5">
                <Checkbox checked={done} onChange={() => onToggle(task)} aria-label={m.toggleLabel(task.title)} />
              </span>
              {showTime && <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-[#5e5d58]">{task.time}</span>}
              {/* 제목을 누르면 편집(할 일 화면과 같다). 따로 [편집] 버튼을 두지 않아 좁은 곳에서도 제목이 넓게 보인다. */}
              <button
                type="button"
                aria-label={m.editButton(task.title)}
                title={m.editText}
                onClick={() => onEdit(task)}
                className={`min-w-0 flex-1 whitespace-normal rounded text-left [overflow-wrap:anywhere] hover:underline ${done ? 'text-[#8a8983] line-through' : 'text-ink'}`}
              >
                {task.title}
              </button>
              {overdue && <span className="shrink-0 rounded-full bg-[#fbeee9] px-2 py-0.5 text-[11px] text-[#7d2a21]">{m.overdue}</span>}
              {rowError?.id === task.id && (
                <p role="alert" className="basis-full text-xs text-[#7d2a21]">
                  {rowError.text}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )

  return (
    <div className="flex flex-col gap-2">
      {timed.length > 0 && list(m.timedHeading, timed, true)}
      {untimed.length > 0 && list(m.untimedHeading, untimed, false)}
    </div>
  )
}

/** 오늘 날짜의 Google 일정. 연결돼 있거나 연결이 끊겼을 때만 보인다(연결하지 않았으면 아무것도 쓰지 않는다. 연결은 Arms 화면에서). */
function GoogleToday({
  calendar,
  now,
  onReconnect,
  onOpenEvent,
  google
}: {
  calendar: CalendarToday | null
  now: Date
  onReconnect: () => void
  onOpenEvent: (id: string) => void
  google?: DayDialogProps['google']
}) {
  const section = (body: ReactNode) => (
    <section aria-label={m.googleSection} className="mt-4 border-t border-line pt-3">
      <h3 className="mb-2 text-xs font-semibold text-[#5e5d58]">{m.googleSection}</h3>
      {body}
    </section>
  )
  const button = 'min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong'

  // 달력 화면: 읽는 중·읽지 못함·연결 안 됨도 구분해 보인다.
  if (google?.loading && calendar === null) return section(<p className="text-sm text-[#5e5d58]">{c.loading}</p>)
  if (calendar === null || !calendar.configured) return null
  if (google?.readFailed) {
    return section(
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-[#7d2a21]">
          {c.loadFailed}
        </p>
        <button type="button" onClick={google.onRetry} className={button}>
          {c.retry}
        </button>
      </div>
    )
  }
  const state = calendar.status.state
  if (google?.showDisconnected && state === 'off') {
    return section(
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-[#5e5d58]">{c.notConnected}</p>
        <button type="button" onClick={onReconnect} className={button}>
          {c.connect}
        </button>
      </div>
    )
  }
  if (google?.showDisconnected && state === 'connecting') return section(<p className="text-sm text-[#5e5d58]">{c.connecting}</p>)
  if (state !== 'error' && state !== 'on') return null
  return section(
    calendar.status.state === 'error' ? (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-[#7d2a21]">
          {calendar.status.reason}
        </p>
        <button type="button" onClick={onReconnect} className={button}>
          {c.reconnect}
        </button>
      </div>
    ) : (
      <GoogleEvents events={calendar.events} now={now} onOpenEvent={onOpenEvent} />
    )
  )
}

function GoogleEvents({ events, now, onOpenEvent }: { events: CalendarEvent[]; now: Date; onOpenEvent: (id: string) => void }) {
  if (events.length === 0) return <p className="text-sm text-[#5e5d58]">{c.noEvents}</p>
  const ms = now.getTime()
  const phase = (e: CalendarEvent): 'allDay' | 'past' | 'now' | 'later' =>
    e.allDay ? 'allDay' : new Date(e.end).getTime() <= ms ? 'past' : new Date(e.start).getTime() <= ms ? 'now' : 'later'

  return (
    <ul className="flex flex-col gap-1">
      {events.map((e) => {
        const p = phase(e)
        const row = (
          <>
            <span className="w-24 shrink-0 text-xs tabular-nums text-[#5e5d58]">{e.allDay ? c.allDay : `${hhmm(e.start)}~${hhmm(e.end)}`}</span>
            <span className="min-w-0 flex-1 whitespace-normal text-sm [overflow-wrap:anywhere]">{e.title}</span>
            {p === 'now' && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">{c.now}</span>}
          </>
        )
        const cls = `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
          p === 'now' ? 'bg-accent-soft font-semibold text-accent-strong' : p === 'past' ? 'text-[#8a8983]' : 'text-ink'
        }`
        return (
          <li key={e.id} data-phase={p} aria-current={p === 'now' ? 'time' : undefined}>
            {e.url ? (
              <button type="button" aria-label={c.eventLabel(e.title)} onClick={() => onOpenEvent(e.id)} className={`${cls} hover:bg-black/5`}>
                {row}
              </button>
            ) : (
              <div className={cls}>{row}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

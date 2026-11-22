import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'
import { TaskRow } from './TaskRow'

const t = ko.tasks.overdue

interface OverdueSectionProps {
  tasks: Task[]
  today: string
  activeId: string | null
  pending: ReadonlyMap<string, boolean>
  onToggle: (task: Task) => void
  onOpen: (task: Task) => void
  /** 성공하면 true. 성공했을 때만 선택을 비운다. */
  onMoveToToday: (ids: string[]) => Promise<boolean>
  onMoveToSomeday: (ids: string[]) => Promise<boolean>
  onReschedule: (ids: string[], date: string) => Promise<boolean>
}

export function OverdueSection(props: OverdueSectionProps) {
  const { tasks, today, activeId, pending } = props
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [date, setDate] = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)

  // 목록에서 사라진 항목은 선택에서도 뺀다.
  const chosen = tasks.filter((task) => selected.has(task.id))
  const ids = chosen.map((task) => task.id)
  const allSelected = tasks.length > 0 && chosen.length === tasks.length
  const hasRepeat = chosen.some((task) => task.repeat !== null)

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = chosen.length > 0 && !allSelected
  }, [chosen.length, allSelected])

  function toggleOne(id: string, on: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function run(action: () => Promise<boolean>): Promise<void> {
    if (await action()) setSelected(new Set())
  }

  const none = ids.length === 0
  const buttonClass =
    'rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <section aria-label={t.title} className="mb-5 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-amber-800">
          {t.title} <span className="font-normal">({tasks.length})</span>
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={(event) => setSelected(event.target.checked ? new Set(tasks.map((task) => task.id)) : new Set())}
            className="size-4 accent-indigo-600"
          />
          {t.selectAll}
        </label>
        {!none && <span className="text-xs text-slate-500">{t.selectedCount(ids.length)}</span>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={none} onClick={() => void run(() => props.onMoveToToday(ids))} className={buttonClass}>
          {t.toToday}
        </button>
        <button
          type="button"
          disabled={none || hasRepeat}
          onClick={() => void run(() => props.onMoveToSomeday(ids))}
          className={buttonClass}
        >
          {t.toSomeday}
        </button>
        <input
          type="date"
          aria-label={t.dateLabel}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={none || date === ''}
          onClick={() => void run(() => props.onReschedule(ids, date))}
          className={buttonClass}
        >
          {t.reschedule}
        </button>
      </div>
      {hasRepeat && <p className="mt-2 text-xs text-amber-700">{t.repeatBlocksSomeday}</p>}

      <ul className="mt-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            checked={pending.get(task.id) ?? task.status === 'done'}
            fading={pending.has(task.id)}
            active={task.id === activeId}
            selected={selected.has(task.id)}
            onSelect={(on) => toggleOne(task.id, on)}
            onToggle={() => props.onToggle(task)}
            onOpen={() => props.onOpen(task)}
          />
        ))}
      </ul>
    </section>
  )
}

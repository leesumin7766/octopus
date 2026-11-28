import { useState, type ReactNode } from 'react'
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
  /** 성공하면 true. 목록은 호출한 쪽에서 새로 불러온다. */
  onMoveToToday: (ids: string[]) => Promise<boolean>
  onMoveToSomeday: (ids: string[]) => Promise<boolean>
  onReschedule: (ids: string[], date: string) => Promise<boolean>
  /** 행 맨 오른쪽의 더보기(⋯) */
  renderMenu?: (task: Task) => ReactNode
}

/** '나중에'로 보낼 수 없는 항목이면 그 이유(없으면 null). 루틴 항목과 반복 할 일이 해당한다. */
function somedayBlockedReason(task: Task): string | null {
  if (task.routineId !== null) return t.routineBlocksSomeday
  if (task.repeat !== null) return t.repeatBlocksSomeday
  return null
}

const buttonClass =
  'rounded-md border border-[#dad9d4] bg-white px-2.5 py-1 text-xs font-medium text-[#4a4945] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40'

export function OverdueSection(props: OverdueSectionProps) {
  const { tasks, today, activeId, pending } = props
  const [openDateId, setOpenDateId] = useState<string | null>(null)
  const [keptNotice, setKeptNotice] = useState<string | null>(null)

  const movable = tasks.filter((task) => somedayBlockedReason(task) === null)
  const kept = tasks.length - movable.length

  async function allToSomeday(): Promise<void> {
    if (movable.length === 0) return
    const ok = await props.onMoveToSomeday(movable.map((task) => task.id))
    // 반복 할 일과 루틴 항목은 건너뛰었다고 알려 준다.
    setKeptNotice(ok && kept > 0 ? t.keptRepeating(kept) : null)
  }

  return (
    <section aria-label={t.title} className="mb-5 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-amber-800">
          {t.title} <span className="font-normal">({tasks.length})</span>
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" disabled={tasks.length === 0} onClick={() => void props.onMoveToToday(tasks.map((task) => task.id))} className={buttonClass}>
            {t.allToToday}
          </button>
          <button type="button" disabled={movable.length === 0} onClick={() => void allToSomeday()} className={buttonClass}>
            {t.allToSomeday}
          </button>
        </div>
      </div>
      {keptNotice && (
        <p role="status" className="mt-2 text-xs text-amber-700">
          {keptNotice}
        </p>
      )}

      <ul className="mt-2">
        {tasks.map((task) => {
          const blocked = somedayBlockedReason(task)
          const dateOpen = openDateId === task.id
          return (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              checked={pending.get(task.id) ?? task.status === 'done'}
              fading={pending.has(task.id)}
              active={task.id === activeId}
              onToggle={() => props.onToggle(task)}
              onOpen={() => props.onOpen(task)}
              menu={props.renderMenu?.(task)}
              trailing={
                // 행 동작은 마우스를 올리거나 키보드로 들어갔을 때만 보인다(ATDT 와 같게). 날짜 칸을 연 동안은 계속 보인다.
                <div className={`flex shrink-0 flex-wrap items-center justify-end gap-1.5 ${dateOpen ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'}`}>
                  <button type="button" onClick={() => void props.onMoveToToday([task.id])} className={buttonClass}>
                    {t.toToday}
                  </button>
                  <button
                    type="button"
                    disabled={blocked !== null}
                    title={blocked ?? undefined}
                    onClick={() => void props.onMoveToSomeday([task.id])}
                    className={buttonClass}
                  >
                    {t.toSomeday}
                  </button>
                  <button
                    type="button"
                    aria-expanded={dateOpen}
                    aria-label={`${t.reschedule}: ${task.title}`}
                    onClick={() => setOpenDateId(dateOpen ? null : task.id)}
                    className={buttonClass}
                  >
                    {t.reschedule}
                  </button>
                  {dateOpen && (
                    <input
                      type="date"
                      aria-label={`${t.dateLabel}: ${task.title}`}
                      onChange={(event) => {
                        const date = event.target.value
                        if (date === '') return
                        void props.onReschedule([task.id], date).then((ok) => {
                          if (ok) setOpenDateId(null)
                        })
                      }}
                      className="rounded-md border border-[#dad9d4] bg-white px-2 py-1 text-xs"
                    />
                  )}
                </div>
              }
            />
          )
        })}
      </ul>
    </section>
  )
}

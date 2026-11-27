import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError, IpcResult } from '../../shared/ipc'
import type { Routine, RoutineHistory, RoutineInput, RoutineListData } from '../../shared/routines/types'
import { useDataChanged } from '../dataEvents'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'
import { formatDate, formatDays, todayString } from '../tasks/format'
import { Checkbox } from '../ui/Checkbox'
import { RoutineForm } from './RoutineForm'

const t = ko.routines

const CELL_SYMBOL = { done: '✓', missed: '✕', pending: '○', closed: '–', none: '·' } as const
const CELL_STYLE = {
  done: 'bg-emerald-100 text-emerald-700',
  missed: 'bg-red-50 text-red-500',
  pending: 'bg-sky-50 text-sky-600',
  closed: 'bg-slate-100 text-slate-400',
  none: 'text-slate-300'
} as const

type CellKind = keyof typeof CELL_SYMBOL

const api = () => window.octopus

export function RoutinesScreen() {
  const [data, setData] = useState<RoutineListData | null>(null)
  const [history, setHistory] = useState<RoutineHistory | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const loadSeq = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current
    const [list, past] = await Promise.all([api().routines.list(), api().routines.history()])
    if (!mounted.current || seq !== loadSeq.current) return
    if (!list.ok) return setError(list.error)
    if (!past.ok) return setError(past.error)
    setData(list.data)
    setHistory(past.data)
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    // 창이 다시 포커스될 때, 자정이 지나 새 날이 되었을 수 있으므로 다시 읽는다.
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  // 데이터가 바뀌면(지시하기 등) 다시 읽는다. 쓰던 폼 입력은 그대로 둔다.
  useDataChanged(() => void refresh())

  /** 실패하면 알림을 띄우고 결과를 그대로 돌려준다(invalid_input 은 폼이 필드 옆에 보여 준다). */
  async function mutate<R>(run: () => Promise<IpcResult<R>>): Promise<IpcResult<R>> {
    const result = await run()
    if (result.ok) {
      setError(null)
      await refresh()
    } else if (result.error.code !== 'invalid_input') {
      setError(result.error)
      if (result.error.code === 'not_found') void refresh()
    }
    return result
  }

  const toggleToday = (taskId: string, done: boolean): Promise<unknown> =>
    mutate(() => api().tasks.setStatus(taskId, done ? 'open' : 'done'))

  const createRoutine = (input: RoutineInput) => mutate(() => api().routines.create(input))

  const saveRoutine = async (routine: Routine, input: RoutineInput) => {
    const result = await mutate(() => api().routines.update(routine.id, { title: input.title, days: input.days }))
    if (result.ok) setEditingId(null)
    return result
  }

  const removeRoutine = async (routine: Routine): Promise<void> => {
    const result = await mutate(() => api().routines.remove(routine.id))
    if (result.ok || result.error.code === 'not_found') setConfirmingId(null)
  }

  const today = todayString()
  const routines = data?.routines ?? []
  const historyTitle = t.historyTitle(history ? history.dates.length : 14)

  const moveRoutine = (routine: Routine, direction: 'up' | 'down') => void mutate(() => api().routines.move(routine.id, direction))

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50 text-slate-900">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <section aria-label={t.todayTitle}>
          <h1 className="mb-2 text-lg font-semibold">{t.todayTitle}</h1>
          {!data ? (
            error ? null : <p className="text-sm text-slate-500">{ko.tasks.loading}</p>
          ) : data.todayItems.length === 0 ? (
            <p className="text-sm text-slate-500">{t.todayEmpty}</p>
          ) : (
            <ul className="rounded-lg border border-slate-200 bg-white">
              {data.todayItems.map((task) => {
                const done = task.status === 'done'
                return (
                  <li key={task.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                    <Checkbox checked={done} onChange={() => void toggleToday(task.id, done)} aria-label={`${ko.tasks.complete}: ${task.title}`} />
                    <span className={done ? 'text-slate-400 line-through' : 'text-slate-900'}>{task.title}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-label={historyTitle}>
          <h2 className="mb-2 text-base font-semibold">{historyTitle}</h2>
          {!history || history.routines.length === 0 ? (
            <p className="text-sm text-slate-500">{t.historyEmpty}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
              <table aria-label={historyTitle} className="border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="pr-3 text-left font-medium text-slate-500" scope="col" />
                    {history.dates.map((date) => (
                      <th
                        key={date}
                        scope="col"
                        title={formatDate(date, today)}
                        className={`w-7 text-center font-normal ${date === today ? 'text-indigo-600' : 'text-slate-500'}`}
                      >
                        {Number(date.slice(8))}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.routines.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className={`max-w-40 truncate pr-3 text-left font-normal ${row.active ? '' : 'text-slate-400'}`}>
                        {row.title}
                      </th>
                      {history.dates.map((date, index) => {
                        const kind = row.cells[index]
                        return (
                          <td
                            key={date}
                            aria-label={`${row.title} ${formatDate(date, today)}: ${t.cell[kind]}`}
                            title={`${formatDate(date, today)} ${t.cell[kind]}`}
                            className={`h-7 w-7 text-center ${CELL_STYLE[kind]}`}
                          >
                            {CELL_SYMBOL[kind]}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">{t.legend}</p>
            </div>
          )}
        </section>

        <section aria-label={t.manageTitle}>
          <h2 className="mb-2 text-base font-semibold">{t.manageTitle}</h2>
          <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
            <RoutineForm submitLabel={t.add} onSubmit={createRoutine} resetOnSuccess />
          </div>

          {data && routines.length === 0 && <p className="text-sm text-slate-500">{t.empty}</p>}
          <ul className="space-y-2">
            {routines.map((routine) => (
              <li key={routine.id} className="rounded-lg border border-slate-200 bg-white p-3">
                {editingId === routine.id ? (
                  <RoutineForm
                    initial={{ title: routine.title, days: routine.days }}
                    submitLabel={t.save}
                    onSubmit={(input) => saveRoutine(routine, input)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`font-medium ${routine.active ? '' : 'text-slate-400'}`}>{routine.title}</span>
                      <span className="text-xs text-slate-500">{formatDays(routine.days)}</span>
                      {!routine.active && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">{t.off}</span>}
                      <span className="ml-auto flex gap-1.5 text-xs">
                        <button
                          type="button"
                          aria-label={`${t.moveUp}: ${routine.title}`}
                          disabled={routines[0]?.id === routine.id}
                          onClick={() => moveRoutine(routine, 'up')}
                          className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`${t.moveDown}: ${routine.title}`}
                          disabled={routines[routines.length - 1]?.id === routine.id}
                          onClick={() => moveRoutine(routine, 'down')}
                          className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(routine.id)}
                          className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100"
                        >
                          {t.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => void mutate(() => api().routines.update(routine.id, { active: !routine.active }))}
                          className="rounded px-2 py-1 text-slate-700 hover:bg-slate-100"
                        >
                          {routine.active ? t.turnOff : t.turnOn}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(routine.id)}
                          className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
                        >
                          {t.remove}
                        </button>
                      </span>
                    </div>
                    {confirmingId === routine.id && (
                      <div
                        role="alertdialog"
                        aria-label={t.confirmRemove}
                        className="mt-2 rounded-md border border-red-200 bg-red-50 p-3"
                      >
                        <p className="text-sm text-red-800">{t.confirmRemove}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void removeRoutine(routine)}
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
        </section>
      </div>
    </div>
  )
}

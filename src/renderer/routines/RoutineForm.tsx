import { useState, type FormEvent } from 'react'
import type { IpcResult } from '../../shared/ipc'
import type { RoutineInput } from '../../shared/routines/types'
import { ko } from '../i18n/ko'

const t = ko.routines
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]

interface RoutineFormProps {
  initial?: { title: string; days: number[] }
  submitLabel: string
  /** invalid_input 이외의 오류는 부모가 알림으로 보여 준다. 성공하면 폼을 닫는 건 부모가 정한다. */
  onSubmit: (input: RoutineInput) => Promise<IpcResult<unknown>>
  onCancel?: () => void
  /** 추가 폼은 성공하면 비운다. */
  resetOnSuccess?: boolean
}

type Errors = Partial<Record<'title' | 'days' | 'general', string>>

const same = (a: number[], b: number[]): boolean => [...a].sort().join() === [...b].sort().join()

export function RoutineForm({ initial, submitLabel, onSubmit, onCancel, resetOnSuccess }: RoutineFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [days, setDays] = useState<number[]>(initial?.days ?? ALL_DAYS)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  function toggleDay(day: number): void {
    setDays((previous) => (previous.includes(day) ? previous.filter((d) => d !== day) : [...previous, day]))
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const result = await onSubmit({ title, days: [...days].sort((a, b) => a - b) })
      if (result.ok) {
        setErrors({})
        if (resetOnSuccess) {
          setTitle('')
          setDays(ALL_DAYS)
        }
      } else if (result.error.code === 'invalid_input') {
        const next: Errors = {}
        for (const field of result.error.fields ?? []) {
          if (field === 'title') next.title = t.fieldErrors.title
          else if (field === 'days') next.days = t.fieldErrors.days
          else next.general = t.fieldErrors.general
        }
        setErrors(Object.keys(next).length > 0 ? next : { general: t.fieldErrors.general })
      }
    } finally {
      setBusy(false)
    }
  }

  const quick = (label: string, set: number[]) => (
    <button
      type="button"
      onClick={() => setDays(set)}
      aria-pressed={same(days, set)}
      className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100 aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50"
    >
      {label}
    </button>
  )

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-2">
      <input
        value={title}
        aria-label={t.nameLabel}
        placeholder={t.namePlaceholder}
        onChange={(event) => setTitle(event.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      {errors.title && (
        <p role="alert" className="text-xs text-red-600">
          {errors.title}
        </p>
      )}

      <div role="group" aria-label={t.daysLabel} className="flex flex-wrap items-center gap-1.5">
        {ALL_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            aria-pressed={days.includes(day)}
            aria-label={t.weekdayLong[day]}
            onClick={() => toggleDay(day)}
            className="size-7 rounded-full border border-slate-300 text-xs text-slate-600 aria-pressed:border-indigo-600 aria-pressed:bg-indigo-600 aria-pressed:text-white"
          >
            {t.weekdayNames[day]}
          </button>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        {quick(t.everyDay, ALL_DAYS)}
        {quick(t.weekdays, WEEKDAYS)}
      </div>
      {errors.days && (
        <p role="alert" className="text-xs text-red-600">
          {errors.days}
        </p>
      )}
      {errors.general && (
        <p role="alert" className="text-xs text-red-600">
          {errors.general}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            {t.cancel}
          </button>
        )}
      </div>
    </form>
  )
}

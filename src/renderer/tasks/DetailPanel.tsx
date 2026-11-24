import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { IpcResult } from '../../shared/ipc'
import type { Memo } from '../../shared/memos/types'
import type { RepeatRule, Task, TaskBucket, TaskFields, TaskPriority } from '../../shared/tasks/types'
import { weekdayOf } from '../../shared/tasks/dates'
import { ko } from '../i18n/ko'
import { fieldErrorsFrom, type FieldErrors } from './errors'
import { formatRepeat, splitTags, todayString } from './format'

const t = ko.tasks.detail
const R = ko.tasks.detail.repeatEdit

interface DetailPanelProps {
  task: Task
  /** invalid_input 이외의 오류는 부모가 알림으로 보여 준다. 성공하면 부모가 패널을 닫는다. */
  onSave: (patch: Partial<TaskFields>) => Promise<IpcResult<Task>>
  onRemove: () => Promise<void>
  /** 취소: 목록에서만 사라진다(지우지 않는다). */
  onCancel: () => Promise<void>
  onClose: () => void
  /** 이 할 일로 만든 메모가 있으면 읽기 전용으로 보여 준다. */
  linkedMemo?: Memo | null
}

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'

/** 반복 종류: 없음 · 매일 · 평일 · 매주(요일 여러 개) · 매월(일) · 매년 */
type RepeatKind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
const KIND_ORDER: readonly RepeatKind[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']
const WEEKDAYS_ONLY = [1, 2, 3, 4, 5]

function kindOf(rule: RepeatRule | null): RepeatKind {
  if (rule === null) return 'none'
  if (rule.freq === 'daily') return 'daily'
  if (rule.freq === 'monthly') return 'monthly'
  if (rule.freq === 'yearly') return 'yearly'
  const days = [...new Set(rule.byWeekday ?? [])].sort((a, b) => a - b)
  return rule.interval === 1 && days.join() === WEEKDAYS_ONLY.join() ? 'weekdays' : 'weekly'
}

/** 종류·간격·요일·날짜로 반복 규칙을 만든다. 모양이 틀리면 이유를 돌려준다. */
function buildRule(
  kind: RepeatKind,
  interval: string,
  weekdays: number[],
  monthDay: string
): { rule: RepeatRule | null; error?: { field: 'interval' | 'weekdays' | 'monthDay'; message: string } } {
  if (kind === 'none') return { rule: null }
  if (kind === 'weekdays') return { rule: { freq: 'weekly', interval: 1, byWeekday: WEEKDAYS_ONLY } }

  const n = Number(interval)
  const every = Number.isInteger(n) && n >= 1 && n <= 99 ? n : null
  if (every === null) return { rule: null, error: { field: 'interval', message: R.errors.interval } }
  if (kind === 'daily') return { rule: { freq: 'daily', interval: every } }
  if (kind === 'yearly') return { rule: { freq: 'yearly', interval: every } }
  if (kind === 'weekly') {
    if (weekdays.length === 0) return { rule: null, error: { field: 'weekdays', message: R.errors.weekdays } }
    return { rule: { freq: 'weekly', interval: every, byWeekday: [...new Set(weekdays)].sort((a, b) => a - b) } }
  }
  // monthly
  const day = Number(monthDay)
  if (!Number.isInteger(day) || day < 1 || day > 31) return { rule: null, error: { field: 'monthDay', message: R.errors.monthDay } }
  return { rule: { freq: 'monthly', interval: every, byMonthDay: day } }
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function DetailPanel({ task, onSave, onRemove, onCancel, onClose, linkedMemo }: DetailPanelProps) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [bucket, setBucket] = useState<TaskBucket>(task.bucket)
  const [date, setDate] = useState(task.date ?? '')
  const [time, setTime] = useState(task.time ?? '')
  const [deadline, setDeadline] = useState(task.deadline ?? '')
  const [priority, setPriority] = useState(String(task.priority))
  const [project, setProject] = useState(task.project ?? '')
  const [tags, setTags] = useState(task.tags.join(', '))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  // 반복 편집 상태. 처음에는 저장된 규칙을 보여 준다.
  const startDay = task.date ?? todayString()
  const [kind, setKind] = useState<RepeatKind>(kindOf(task.repeat))
  const [everyN, setEveryN] = useState(String(task.repeat?.interval ?? 1))
  const [weekdays, setWeekdays] = useState<number[]>(task.repeat?.byWeekday ?? [weekdayOf(startDay)])
  const [monthDay, setMonthDay] = useState(String(task.repeat?.byMonthDay ?? Number(startDay.slice(8))))

  // 루틴 항목은 그날 날짜에 묶여 있어서 날짜·보관함·반복을 바꿀 수 없다.
  const fromRoutine = task.routineId !== null
  const built = buildRule(kind, everyN, weekdays, monthDay)
  // 반복을 켜면 보관함은 예정(날짜 필요)으로 고정된다.
  const repeating = kind !== 'none'

  // 날짜를 넣으면 예정, 날짜를 지우면 수신함으로 맞춰 준다(보관함과 날짜는 서로 맞아야 저장된다).
  function changeDate(value: string): void {
    setDate(value)
    if (value !== '' && bucket !== 'scheduled') setBucket('scheduled')
    if (value === '' && bucket === 'scheduled') setBucket('inbox')
  }

  function changeBucket(value: TaskBucket): void {
    setBucket(value)
    if (value !== 'scheduled') {
      setDate('')
      setTime('')
    }
  }

  function toggleWeekday(day: number): void {
    setWeekdays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (saving) return

    // 반복 규칙은 저장 전에 모양을 본다(틀리면 필드 옆에 이유를 보여 준다).
    if (!fromRoutine && built.error) {
      setErrors({ repeat: built.error.message })
      return
    }

    // 반복을 켰는데 날짜가 없으면 오늘로 채운다.
    const repeatRule = fromRoutine ? task.repeat : built.rule
    const effectiveDate = repeatRule !== null && date === '' ? todayString() : date
    if (repeatRule !== null && date === '') setDate(effectiveDate)
    const effectiveBucket: TaskBucket = repeatRule !== null ? 'scheduled' : bucket

    setSaving(true)
    try {
      const result = await onSave({
        title,
        notes,
        bucket: effectiveBucket,
        date: effectiveDate === '' ? null : effectiveDate,
        time: time === '' ? null : time,
        deadline: deadline === '' ? null : deadline,
        priority: Number(priority) as TaskPriority,
        project: project.trim() === '' ? null : project.trim(),
        tags: splitTags(tags),
        repeat: repeatRule
      })
      if (!result.ok && result.error.code === 'invalid_input') setErrors(fieldErrorsFrom(result.error.fields))
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (confirmingRemove) setConfirmingRemove(false)
    else onClose()
  }

  const repeatPreview = built.rule ? R.preview(formatRepeat(built.rule)) : null

  return (
    <aside
      aria-label={t.title}
      onKeyDown={handleKeyDown}
      className="absolute inset-y-0 right-0 z-20 w-80 overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl"
    >
      <form onSubmit={(event) => void handleSave(event)} className="space-y-3">
        {errors.general && (
          <p role="alert" className="text-xs text-red-600">
            {errors.general}
          </p>
        )}

        <Field id="task-title" label={t.titleField} error={errors.title}>
          <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>

        <Field id="task-notes" label={t.notes} error={errors.notes}>
          <textarea
            id="task-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field id="task-bucket" label={t.bucket} error={errors.bucket}>
          <select
            id="task-bucket"
            value={bucket}
            disabled={repeating || fromRoutine}
            onChange={(e) => changeBucket(e.target.value as TaskBucket)}
            className={inputClass}
          >
            {(['inbox', 'scheduled', 'someday'] as const).map((name) => (
              <option key={name} value={name}>
                {t.buckets[name]}
              </option>
            ))}
          </select>
          {repeating && !fromRoutine && <p className="mt-1 text-xs text-slate-500">{t.repeatLocksBucket}</p>}
          {fromRoutine && <p className="mt-1 text-xs text-slate-500">{t.routineLocksDate}</p>}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field id="task-date" label={t.date} error={errors.date}>
            <input
              id="task-date"
              type="date"
              value={date}
              disabled={fromRoutine}
              onChange={(e) => changeDate(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id="task-time" label={t.time} error={errors.time}>
            <input id="task-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field id="task-repeat" label={t.repeat} error={errors.repeat ?? (!fromRoutine ? built.error?.message : undefined)}>
          <select
            id="task-repeat"
            value={kind}
            disabled={fromRoutine}
            onChange={(e) => setKind(e.target.value as RepeatKind)}
            className={inputClass}
          >
            {KIND_ORDER.map((name) => (
              <option key={name} value={name}>
                {R.kinds[name]}
              </option>
            ))}
          </select>
          {fromRoutine && <p className="mt-1 text-xs text-slate-500">{R.routineLocked}</p>}

          {!fromRoutine && (kind === 'daily' || kind === 'weekly' || kind === 'monthly' || kind === 'yearly') && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="task-interval" className="shrink-0 text-xs text-slate-600">
                {R.interval}
              </label>
              <input
                id="task-interval"
                type="number"
                min={1}
                max={99}
                value={everyN}
                onChange={(e) => setEveryN(e.target.value)}
                className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              />
              <span className="text-sm text-slate-700">{R.every[kind]}</span>
            </div>
          )}

          {!fromRoutine && kind === 'weekly' && (
            <div role="group" aria-label={R.weekdaysLabel} className="mt-2 flex gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                const on = weekdays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWeekday(day)}
                    className={`size-8 rounded-full border text-xs ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                  >
                    {ko.tasks.weekdays[day]}
                  </button>
                )
              })}
            </div>
          )}

          {!fromRoutine && kind === 'monthly' && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="task-month-day" className="shrink-0 text-xs text-slate-600">
                {R.monthDayLabel}
              </label>
              <input
                id="task-month-day"
                type="number"
                min={1}
                max={31}
                value={monthDay}
                onChange={(e) => setMonthDay(e.target.value)}
                className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              />
            </div>
          )}

          {!fromRoutine && repeatPreview && <p className="mt-1 text-xs text-slate-500">{repeatPreview}</p>}
        </Field>

        <Field id="task-priority" label={t.priority} error={errors.priority}>
          <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
            {([0, 1, 2, 3] as const).map((level) => (
              <option key={level} value={level}>
                {ko.tasks.priority[level]}
              </option>
            ))}
          </select>
        </Field>

        <Field id="task-deadline" label={t.deadline} error={errors.deadline}>
          <input
            id="task-deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field id="task-project" label={t.project} error={errors.project}>
          <input id="task-project" value={project} onChange={(e) => setProject(e.target.value)} className={inputClass} />
        </Field>

        <Field id="task-tags" label={t.tags} error={errors.tags}>
          <input id="task-tags" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
        </Field>

        {linkedMemo && (
          <section aria-label={t.linkedMemo} className="rounded-md border border-slate-200 bg-slate-50 p-2">
            <h3 className="mb-1 text-xs font-medium text-slate-500">{t.linkedMemo}</h3>
            {/* 메모 본문은 HTML 로 해석하지 않고 글자 그대로, 줄바꿈만 보존해 보여 준다. */}
            <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{linkedMemo.body}</p>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {t.save}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            {t.close}
          </button>
          {!fromRoutine && (
            <button
              type="button"
              title={t.cancelHelp}
              onClick={() => void onCancel()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              {t.cancelTask}
            </button>
          )}
          {fromRoutine ? (
            // 루틴 항목은 지울 수 없다(지워도 다음에 다시 생김). 루틴 설정에서 끄거나 지운다.
            <span className="ml-auto text-xs text-slate-500">{t.routineManage}</span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="ml-auto rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              {t.remove}
            </button>
          )}
        </div>
        {!fromRoutine && <p className="text-xs text-slate-500">{t.cancelHelp}</p>}

        {confirmingRemove && (
          <div role="alertdialog" aria-label={t.confirmRemove} className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-800">{t.confirmRemove}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void onRemove()}
                className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
              >
                {t.confirmRemoveYes}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
              >
                {ko.tasks.detail.cancel}
              </button>
            </div>
          </div>
        )}
      </form>
    </aside>
  )
}

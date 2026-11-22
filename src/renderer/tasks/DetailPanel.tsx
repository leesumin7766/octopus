import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { IpcResult } from '../../shared/ipc'
import type { Memo } from '../../shared/memos/types'
import type { Task, TaskBucket, TaskFields, TaskPriority } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'
import { fieldErrorsFrom, type FieldErrors } from './errors'
import { formatRepeat, splitTags } from './format'

const t = ko.tasks.detail

interface DetailPanelProps {
  task: Task
  /** invalid_input 이외의 오류는 부모가 알림으로 보여 준다. 성공하면 부모가 패널을 닫는다. */
  onSave: (patch: Partial<TaskFields>) => Promise<IpcResult<Task>>
  onRemove: () => Promise<void>
  onClose: () => void
  /** 이 할 일로 만든 메모가 있으면 읽기 전용으로 보여 준다. */
  linkedMemo?: Memo | null
}

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'

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

export function DetailPanel({ task, onSave, onRemove, onClose, linkedMemo }: DetailPanelProps) {
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

  const repeating = task.repeat !== null
  // 루틴 항목은 그날 날짜에 묶여 있어서 날짜·보관함을 바꿀 수 없다.
  const fromRoutine = task.routineId !== null

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

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const result = await onSave({
        title,
        notes,
        bucket,
        date: date === '' ? null : date,
        time: time === '' ? null : time,
        deadline: deadline === '' ? null : deadline,
        priority: Number(priority) as TaskPriority,
        project: project.trim() === '' ? null : project.trim(),
        tags: splitTags(tags)
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

  return (
    <aside
      aria-label={t.title}
      onKeyDown={handleKeyDown}
      className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4"
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

        <Field id="task-bucket" label={t.bucket} error={errors.bucket ?? errors.repeat}>
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
          {repeating && <p className="mt-1 text-xs text-slate-500">{t.repeatLocksBucket}</p>}
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

        <Field id="task-deadline" label={t.deadline} error={errors.deadline}>
          <input
            id="task-deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass}
          />
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

        {task.repeat && (
          <p className="text-xs text-slate-500">
            {t.repeat}: ↻ {formatRepeat(task.repeat)}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
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
            {t.cancel}
          </button>
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
                {t.cancel}
              </button>
            </div>
          </div>
        )}
      </form>
    </aside>
  )
}

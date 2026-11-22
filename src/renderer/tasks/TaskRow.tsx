import type { Task } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'
import { formatDate, formatRepeat, isPastDate } from './format'

const t = ko.tasks

const PRIORITY_STYLE: Record<number, string> = {
  1: 'text-slate-500',
  2: 'text-amber-600',
  3: 'text-red-600'
}

interface TaskRowProps {
  task: Task
  today: string
  /** 완료 체크 표시. 완료한 직후에는 목록이 새로고침되기 전이라 task.status 와 다를 수 있다. */
  checked: boolean
  /** 완료 직후 잠깐 흐려지는 중 */
  fading: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
  /** 지난 할 일 구역에서만 넘긴다. 여러 개를 골라 한꺼번에 옮기는 용도. */
  selected?: boolean
  onSelect?: (selected: boolean) => void
}

export function TaskRow({ task, today, checked, fading, active, onToggle, onOpen, selected, onSelect }: TaskRowProps) {
  const deadlinePast = task.status === 'open' && task.deadline !== null && isPastDate(task.deadline, today)

  return (
    <li
      className={`flex items-center gap-3 rounded-md px-3 py-2 transition-opacity duration-300 ${
        fading ? 'opacity-40' : 'opacity-100'
      } ${active ? 'bg-indigo-50' : 'hover:bg-slate-100'}`}
    >
      {onSelect && (
        <input
          type="checkbox"
          aria-label={`${t.select}: ${task.title}`}
          checked={selected ?? false}
          onChange={(event) => onSelect(event.target.checked)}
          className="size-4 shrink-0 accent-indigo-600"
        />
      )}
      <input
        type="checkbox"
        aria-label={`${t.complete}: ${task.title}`}
        checked={checked}
        onChange={onToggle}
        className="size-5 shrink-0 rounded-full accent-emerald-600"
      />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={`block truncate ${checked ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500">
          {task.date && (
            <span>
              {formatDate(task.date, today)}
              {task.time ? ` ${task.time}` : ''}
            </span>
          )}
          {task.deadline && (
            <span className={deadlinePast ? 'font-semibold text-red-600' : ''}>
              {t.deadline} {formatDate(task.deadline, today)}
            </span>
          )}
          {task.project && <span>#{task.project}</span>}
          {task.priority > 0 && (
            <span className={`font-medium ${PRIORITY_STYLE[task.priority]}`}>!{t.priority[task.priority]}</span>
          )}
          {task.repeat && <span>↻ {formatRepeat(task.repeat)}</span>}
        </span>
      </button>
    </li>
  )
}

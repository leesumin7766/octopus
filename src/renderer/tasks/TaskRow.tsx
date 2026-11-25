import type { ReactNode } from 'react'
import type { Task } from '../../shared/tasks/types'
import { Checkbox } from '../ui/Checkbox'
import { ko } from '../i18n/ko'
import { formatDate, formatRepeat, isPastDate } from './format'

const t = ko.tasks

const PRIORITY_STYLE: Record<number, string> = {
  1: 'text-[#4A4945]',
  2: 'text-amber-700',
  3: 'text-red-600'
}

/** 행 안의 작은 알약 모양 표시(날짜·시각·반복·프로젝트) */
const PILL = 'inline-flex items-center rounded-full bg-[#F0EFEB] px-2 py-0.5 text-xs text-[#4A4945]'

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
  /** 행 오른쪽 끝의 작은 버튼들(예: 지난 할 일의 [오늘로] [나중에]) */
  trailing?: ReactNode
  /** 완료 보기에서 쓰는 완료 시각 표시(예: "15:20 완료") */
  doneLabel?: string
}

export function TaskRow({ task, today, checked, fading, active, onToggle, onOpen, trailing, doneLabel }: TaskRowProps) {
  const deadlinePast = task.status === 'open' && task.deadline !== null && isPastDate(task.deadline, today)

  return (
    <li
      className={`flex items-start gap-3 rounded-[10px] border bg-white px-3 py-2.5 transition-opacity duration-300 ${
        fading ? 'opacity-40' : 'opacity-100'
      } ${active ? 'border-accent ring-1 ring-accent/30' : 'border-[#E4E3DE] hover:border-[#c9c7c0]'}`}
    >
      <span className="mt-0.5">
        <Checkbox checked={checked} onChange={onToggle} aria-label={`${t.complete}: ${task.title}`} />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={`block text-[15px] leading-snug ${checked ? 'text-[#6F6E69] line-through' : 'text-[#1B1B19]'}`}>
          {task.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[#4A4945]">
          {task.date && (
            <span className={PILL}>
              {formatDate(task.date, today)}
              {task.time ? ` ${task.time}` : ''}
            </span>
          )}
          {task.deadline && (
            <span className={`${PILL} ${deadlinePast ? 'bg-red-50 font-semibold text-red-700' : ''}`}>
              {t.deadline} {formatDate(task.deadline, today)}
            </span>
          )}
          {task.repeat && <span className={PILL}>↻ {formatRepeat(task.repeat)}</span>}
          {task.project && <span className={PILL}>#{task.project}</span>}
          {task.priority > 0 && <span className={`${PILL} font-medium ${PRIORITY_STYLE[task.priority]}`}>!{t.priority[task.priority]}</span>}
          {task.routineId !== null && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">{t.routineBadge}</span>
          )}
          {doneLabel && <span className="text-[#1E7A4C]">{doneLabel}</span>}
        </span>
      </button>
      {trailing}
    </li>
  )
}

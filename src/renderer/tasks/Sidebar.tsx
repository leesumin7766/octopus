import type { TaskView } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'

const t = ko.tasks

export const VIEW_ORDER: readonly TaskView[] = ['inbox', 'today', 'upcoming', 'someday', 'done']

interface SidebarProps {
  view: TaskView
  /** 아직 불러오기 전이면 null */
  counts: Record<TaskView, number> | null
  onSelect: (view: TaskView) => void
}

export function Sidebar({ view, counts, onSelect }: SidebarProps) {
  return (
    <nav aria-label={t.viewsNavLabel} className="w-40 shrink-0 border-r border-slate-200 bg-white px-2 py-4">
      <ul className="space-y-1">
        {VIEW_ORDER.map((name) => (
          <li key={name}>
            <button
              type="button"
              aria-current={name === view ? 'page' : undefined}
              onClick={() => onSelect(name)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                name === view ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>{t.views[name]}</span>
              <span className="text-xs text-slate-400">{counts ? counts[name] : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

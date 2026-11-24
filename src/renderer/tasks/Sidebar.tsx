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

/** 보기 목록(수신함·오늘·예정·나중에·완료). 목업처럼 옅은 바탕 위에 고른 보기만 흰 바탕으로 올라온다. */
export function Sidebar({ view, counts, onSelect }: SidebarProps) {
  return (
    <nav aria-label={t.viewsNavLabel} className="w-44 shrink-0 bg-[#EDECE7] px-3 py-5">
      <ul className="flex flex-col gap-0.5">
        {VIEW_ORDER.map((name) => (
          <li key={name}>
            <button
              type="button"
              aria-current={name === view ? 'page' : undefined}
              onClick={() => onSelect(name)}
              className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm ${
                name === view ? 'bg-white font-semibold text-accent' : 'text-ink hover:bg-black/5'
              }`}
            >
              <span>{t.views[name]}</span>
              <span className="text-xs text-[#5E5D58]">{counts ? counts[name] : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

import { ko } from '../i18n/ko'
import { Icon, LayoutIcon, type IconName } from '../ui/Icon'

const t = ko.nav

export type Screen = 'home' | 'tasks' | 'routines' | 'memos'

interface NavItem {
  id: Screen | 'command' | 'arms'
  label: string
  icon: IconName
  /** 아직 없는 화면. 흐리게 보이고 눌러도 아무 일도 없다. */
  soon?: boolean
}

const ITEMS: readonly NavItem[] = [
  { id: 'home', label: t.home, icon: 'home' },
  { id: 'tasks', label: t.tasks, icon: 'tasks' },
  { id: 'routines', label: t.routines, icon: 'checklist' },
  { id: 'memos', label: t.memos, icon: 'memo' },
  { id: 'command', label: t.command, icon: 'command', soon: true },
  { id: 'arms', label: t.arms, icon: 'arms', soon: true }
]

interface NavMenuProps {
  screen: Screen
  collapsed: boolean
  onToggleCollapsed: () => void
  onNavigate: (screen: Screen) => void
  arranging: boolean
  onToggleArranging: () => void
}

/** 왼쪽 메뉴. ☰ 로 펼침(아이콘+이름)/접음(아이콘만). */
export function NavMenu({ screen, collapsed, onToggleCollapsed, onNavigate, arranging, onToggleArranging }: NavMenuProps) {
  const itemClass = `flex min-h-11 w-full items-center gap-3 rounded-[10px] text-sm ${collapsed ? 'justify-center px-0' : 'px-3'}`
  const canArrange = screen === 'home'

  return (
    <nav
      aria-label={t.label}
      className={`flex shrink-0 flex-col gap-4 overflow-hidden bg-nav px-2.5 pb-4 pt-3 transition-[width] duration-150 ${
        collapsed ? 'w-[68px]' : 'w-[200px]'
      }`}
    >
      <div className="flex min-h-11 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t.expand : t.collapse}
          aria-expanded={!collapsed}
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink hover:bg-black/5"
        >
          <Icon name="menu" size={22} />
        </button>
        {!collapsed && <span className="whitespace-nowrap text-base font-semibold text-ink">{ko.appTitle}</span>}
      </div>

      <ul className="flex flex-col gap-0.5">
        {ITEMS.map((item) => {
          const active = !item.soon && item.id === screen
          const base = `${itemClass} whitespace-nowrap`
          if (item.soon) {
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-disabled="true"
                  aria-label={`${item.label} (${t.soon})`}
                  title={`${item.label} — ${t.soon}`}
                  className={`${base} cursor-not-allowed text-ink opacity-45`}
                >
                  <Icon name={item.icon} />
                  {!collapsed && (
                    <>
                      <span>{item.label}</span>
                      <span className="ml-auto text-[11px]">{t.soon}</span>
                    </>
                  )}
                </button>
              </li>
            )
          }
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(item.id as Screen)}
                className={`${base} ${active ? 'bg-white font-semibold text-accent' : 'text-ink hover:bg-black/5'}`}
              >
                <Icon name={item.icon} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        aria-pressed={arranging}
        aria-label={t.arrange}
        disabled={!canArrange}
        title={canArrange ? t.arrange : `${t.arrange} — ${t.arrangeHint}`}
        onClick={onToggleArranging}
        className={`mt-auto flex min-h-12 w-full items-center gap-2.5 rounded-[10px] text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${
          collapsed ? 'justify-center px-0' : 'px-2.5'
        } ${arranging ? 'border-2 border-accent bg-white text-accent' : 'border-2 border-transparent text-ink hover:bg-black/5'}`}
      >
        <LayoutIcon />
        {!collapsed && <span className="whitespace-nowrap">{t.arrange}</span>}
      </button>
    </nav>
  )
}

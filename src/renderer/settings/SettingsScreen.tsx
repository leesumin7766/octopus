import { useEffect, useState } from 'react'
import { DEFAULT_PIE_SLOTS, FIXED_ACTIONS, shortcutAction, type ActionId } from '../../shared/pie/actions'
import type { Shortcut } from '../../shared/shortcuts/types'
import { ko } from '../i18n/ko'
import { longLabel } from '../pie/actions'
import { ModelSection } from './ModelSection'
import { UpdateSection } from './UpdateSection'
import { useSetting } from './useSetting'
import { safeInvoke } from '../safeInvoke'

const t = ko.settings

/**
 * 설정 화면. 지금은 원형 메뉴 8칸이 실행할 동작을 고르는 것만 있다.
 * 바꾸면 곧바로 저장되고, 홈의 원형 메뉴에 그대로 반영된다.
 */
export function SettingsScreen() {
  const { value: slots, setLocal, persist } = useSetting('pie.slots')
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([])

  useEffect(() => {
    let cancelled = false
    void safeInvoke(() => window.octopus.shortcuts.list()).then((result) => {
      if (!cancelled && result.ok) setShortcuts(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function change(index: number, action: ActionId): void {
    if (!slots) return
    const next = slots.map((current, i) => (i === index ? action : current))
    setLocal(next)
    persist(next)
  }

  function reset(): void {
    const defaults = [...DEFAULT_PIE_SLOTS]
    setLocal(defaults)
    persist(defaults)
  }

  /** 목록에 넣을 동작들: 고정 동작 + 바로가기. 지워진 바로가기를 고르고 있는 칸은 그 값도 보여 준다. */
  function optionsFor(current: ActionId): { value: ActionId; label: string }[] {
    const options = [
      ...FIXED_ACTIONS.map((action) => ({ value: action as ActionId, label: longLabel(action, shortcuts) })),
      ...shortcuts.map((shortcut) => ({ value: shortcutAction(shortcut.id) as ActionId, label: longLabel(shortcutAction(shortcut.id), shortcuts) }))
    ]
    if (!options.some((option) => option.value === current)) options.push({ value: current, label: longLabel(current, shortcuts) })
    return options
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-page px-5 py-4 text-ink">
      <h1 className="mb-4 text-lg font-semibold">{t.title}</h1>

      <ModelSection />

      <section aria-label={t.pieTitle} className="max-w-xl rounded-xl border border-line bg-white p-4">
        <h2 className="text-[15px] font-bold">{t.pieTitle}</h2>
        <p className="mb-3 mt-1 text-[13px] text-[#5e5d58]">{t.pieHelp}</p>

        {!slots ? (
          <p className="text-sm text-[#5e5d58]">{ko.tasks.loading}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {slots.map((action, index) => (
              <li key={index} className="flex items-center gap-3">
                <span className="w-36 shrink-0 whitespace-nowrap text-[13px] text-[#5e5d58]">
                  {index + 1}번 · {t.positions[index]}
                </span>
                <select
                  value={action}
                  aria-label={t.slotLabel(index + 1, t.positions[index])}
                  onChange={(event) => change(index, event.target.value as ActionId)}
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#dad9d4] bg-white px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {optionsFor(action).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
        )}

        <button
          type="button"
          onClick={reset}
          disabled={!slots}
          className="mt-4 min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] hover:bg-black/5 disabled:opacity-40"
        >
          {t.reset}
        </button>
      </section>

      <UpdateSection />
    </div>
  )
}

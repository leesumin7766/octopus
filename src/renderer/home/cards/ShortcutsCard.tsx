import { useState, type FormEvent } from 'react'
import type { IpcError, IpcResult } from '../../../shared/ipc'
import type { PathType, Shortcut } from '../../../shared/shortcuts/types'
import { ko } from '../../i18n/ko'
import { errorMessage } from '../../tasks/errors'
import { Icon, type IconName } from '../../ui/Icon'

const t = ko.home.shortcuts

interface ShortcutsCardProps {
  /** 아직 읽어 오기 전이면 null */
  shortcuts: Shortcut[] | null
  /** 바꾼 뒤 목록을 다시 읽게 한다. */
  onChanged: () => void
  /** 바로가기를 연다(실제로 무엇을 여는지는 main 이 id 로 정한다). */
  onOpen: (id: string) => void
}

function iconOf(shortcut: Shortcut): IconName {
  if (shortcut.kind === 'url') return 'link'
  return shortcut.pathType === 'folder' ? 'folder' : 'file'
}

/** 오류를 이 카드 안의 문구로 바꾼다. 주소·이름 문제는 어느 칸이 틀렸는지 알려 준다. */
function messageFor(error: IpcError): string {
  if (error.code === 'invalid_input') {
    if (error.fields?.includes('url')) return t.errors.url
    if (error.fields?.includes('label')) return t.errors.label
  }
  return errorMessage(error)
}

export function ShortcutsCard({ shortcuts, onChanged, onOpen }: ShortcutsCardProps) {
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState<'menu' | 'link' | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<IpcError | null>(null)

  /** 호출 결과를 처리한다: 성공하면 목록을 다시 읽고 true, 실패하면 이 카드에 오류를 보여 주고 false. */
  async function handle<R>(run: () => Promise<IpcResult<R>>): Promise<IpcResult<R>> {
    const result = await run()
    if (result.ok) {
      setError(null)
      onChanged()
    } else {
      setError(result.error)
      if (result.error.code === 'not_found') onChanged()
    }
    return result
  }

  async function addLink(event: FormEvent): Promise<void> {
    event.preventDefault()
    const label = name.trim()
    const result = await handle(() => window.octopus.shortcuts.addUrl(label === '' ? { url } : { url, label }))
    if (result.ok) {
      setUrl('')
      setName('')
      setAdding(null)
    }
  }

  async function pick(kind: PathType): Promise<void> {
    // 취소하면 아무것도 저장되지 않는다(성공이지만 데이터가 null).
    const result = await handle(() => window.octopus.shortcuts.pickPath(kind))
    if (result.ok) setAdding(null)
  }

  async function saveRename(): Promise<void> {
    if (!renaming) return
    const result = await handle(() => window.octopus.shortcuts.rename(renaming.id, renaming.text))
    if (result.ok) setRenaming(null)
  }

  async function remove(id: string): Promise<void> {
    const result = await handle(() => window.octopus.shortcuts.remove(id))
    if (result.ok || result.error.code === 'not_found') setConfirmingId(null)
  }

  const list = shortcuts ?? []
  const buttonClass = 'min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] text-ink hover:bg-black/5'

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {shortcuts && list.length === 0 && adding === null && <p className="text-sm text-[#5e5d58]">{t.empty}</p>}

      <ul className="flex flex-col gap-1.5">
        {list.map((shortcut, index) => (
          <li key={shortcut.id} className="rounded-lg border border-line">
            {managing ? (
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                <span className="text-accent">
                  <Icon name={iconOf(shortcut)} size={18} />
                </span>
                {renaming?.id === shortcut.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void saveRename()
                    }}
                  >
                    <input
                      autoFocus
                      value={renaming.text}
                      aria-label={t.renameLabel(shortcut.label)}
                      onChange={(event) => setRenaming({ id: shortcut.id, text: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.stopPropagation()
                          setRenaming(null)
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-[#dad9d4] px-2 py-1 text-sm outline-none focus:border-accent"
                    />
                    <button type="submit" className={buttonClass}>
                      {t.save}
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">{shortcut.label}</span>
                    <button type="button" onClick={() => setRenaming({ id: shortcut.id, text: shortcut.label })} className="rounded px-2 py-1 text-xs text-ink hover:bg-black/5">
                      {t.rename}
                    </button>
                    <button
                      type="button"
                      aria-label={t.moveUp(shortcut.label)}
                      disabled={index === 0}
                      onClick={() => void handle(() => window.octopus.shortcuts.move(shortcut.id, 'up'))}
                      className="rounded p-1 text-ink hover:bg-black/5 disabled:opacity-30"
                    >
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={t.moveDown(shortcut.label)}
                      disabled={index === list.length - 1}
                      onClick={() => void handle(() => window.octopus.shortcuts.move(shortcut.id, 'down'))}
                      className="rounded p-1 text-ink hover:bg-black/5 disabled:opacity-30"
                    >
                      <Icon name="down" size={16} />
                    </button>
                    <button type="button" onClick={() => setConfirmingId(shortcut.id)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                      {t.remove}
                    </button>
                  </>
                )}
                {confirmingId === shortcut.id && (
                  <div role="alertdialog" aria-label={t.confirmRemove} className="flex w-full flex-wrap items-center gap-2 rounded-md bg-red-50 px-2 py-1.5">
                    <span className="flex-1 text-xs text-red-800">{t.confirmRemove}</span>
                    <button type="button" onClick={() => void remove(shortcut.id)} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">
                      {t.confirmRemoveYes}
                    </button>
                    <button type="button" onClick={() => setConfirmingId(null)} className="rounded-md border border-[#dad9d4] bg-white px-2.5 py-1 text-xs">
                      {t.cancel}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                title={shortcut.target}
                aria-label={shortcut.label}
                onClick={() => onOpen(shortcut.id)}
                className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-black/5"
              >
                <span className="text-accent">
                  <Icon name={iconOf(shortcut)} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{shortcut.label}</span>
                <span className="text-[11px] text-[#5e5d58]">{t.kinds[shortcut.kind === 'url' ? 'url' : (shortcut.pathType ?? 'file')]}</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {messageFor(error)}
        </p>
      )}

      {adding === 'menu' && (
        <div role="group" aria-label={t.addMenuLabel} className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setAdding('link')} className={buttonClass}>
            {t.addLink}
          </button>
          <button type="button" onClick={() => void pick('file')} className={buttonClass}>
            {t.addFile}
          </button>
          <button type="button" onClick={() => void pick('folder')} className={buttonClass}>
            {t.addFolder}
          </button>
          <button type="button" onClick={() => setAdding(null)} className={buttonClass}>
            {t.cancel}
          </button>
        </div>
      )}

      {adding === 'link' && (
        <form onSubmit={(event) => void addLink(event)} className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={url}
            aria-label={t.urlLabel}
            placeholder={t.urlPlaceholder}
            onChange={(event) => setUrl(event.target.value)}
            className="min-h-9 rounded-lg border border-[#dad9d4] px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <input
            value={name}
            aria-label={t.nameLabel}
            placeholder={t.nameLabel}
            onChange={(event) => setName(event.target.value)}
            className="min-h-9 rounded-lg border border-[#dad9d4] px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex gap-1.5">
            <button type="submit" className="min-h-9 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white hover:bg-accent-strong">
              {t.submit}
            </button>
            <button type="button" onClick={() => setAdding(null)} className={buttonClass}>
              {t.cancel}
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2">
        {adding === null && (
          <button type="button" onClick={() => setAdding('menu')} className="py-1 text-[13px] text-accent hover:underline">
            {t.add}
          </button>
        )}
        {list.length > 0 && (
          <button
            type="button"
            aria-pressed={managing}
            onClick={() => {
              setManaging((on) => !on)
              setRenaming(null)
              setConfirmingId(null)
            }}
            className="ml-auto py-1 text-[13px] text-[#5e5d58] hover:underline"
          >
            {managing ? t.doneManage : t.manage}
          </button>
        )}
      </div>
    </div>
  )
}

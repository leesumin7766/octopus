import { useRef, useState, type FormEvent } from 'react'
import type { IpcError, IpcResult } from '../../../shared/ipc'
import type { PathType, Shortcut } from '../../../shared/shortcuts/types'
import { ko } from '../../i18n/ko'
import { safeInvoke } from '../../safeInvoke'
import { errorMessage } from '../../tasks/errors'
import { Icon, type IconName } from '../../ui/Icon'

const t = ko.home.shortcuts

interface ShortcutsCardProps {
  /** 아직 읽어 오기 전이면 null */
  shortcuts: Shortcut[] | null
  /** 마지막 목록 읽기가 실패했는지. 빈 목록과 구분해 다시 시도를 보여 준다. */
  loadFailed: boolean
  /** 바꾼 뒤 목록을 다시 읽게 한다(다시 시도에도 쓴다). */
  onChanged: () => void
  /** 바로가기를 연다(실제로 무엇을 여는지는 main 이 id 로 정한다). */
  onOpen: (id: string) => void
}

function iconOf(shortcut: Shortcut): IconName {
  if (shortcut.kind === 'url') return 'link'
  return shortcut.pathType === 'folder' ? 'folder' : 'file'
}

function kindOf(shortcut: Shortcut): string {
  return t.kinds[shortcut.kind === 'url' ? 'url' : (shortcut.pathType ?? 'file')]
}

/** 오류를 이 카드 안의 문구로 바꾼다. 주소·이름 문제는 어느 칸이 틀렸는지 알려 준다. */
function messageFor(error: IpcError): string {
  if (error.code === 'invalid_input') {
    if (error.fields?.includes('url')) return t.errors.url
    if (error.fields?.includes('label')) return t.errors.label
  }
  return errorMessage(error)
}

/** 긴 이름·주소도 칸을 넘지 않고 줄바꿈된다. */
const wrap = 'min-w-0 [overflow-wrap:anywhere]'

export function ShortcutsCard({ shortcuts, loadFailed, onChanged, onOpen }: ShortcutsCardProps) {
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState<'menu' | 'link' | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  /** 저장·이동·삭제 요청이 진행 중인지. 연속 클릭·Enter 로 같은 요청이 두 번 가지 않게 동기적으로 막는다. */
  const busy = useRef(false)
  const [pending, setPending] = useState(false)

  /**
   * 바꾸는 요청 하나를 보낸다. 다른 요청이 진행 중이면 보내지 않고 null.
   * 성공하면 목록을 다시 읽고, 실패하면 이 카드에 오류를 보여 준다(입력값은 호출한 쪽이 성공일 때만 지운다).
   */
  async function handle<R>(run: () => Promise<IpcResult<R>>): Promise<IpcResult<R> | null> {
    if (busy.current) return null
    busy.current = true
    setPending(true)
    try {
      const result = await safeInvoke(run)
      if (result.ok) {
        setError(null)
        onChanged()
      } else {
        setError(result.error)
        if (result.error.code === 'not_found') onChanged()
      }
      return result
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function addLink(event: FormEvent): Promise<void> {
    event.preventDefault()
    const label = name.trim()
    const result = await handle(() => window.octopus.shortcuts.addUrl(label === '' ? { url } : { url, label }))
    if (result?.ok) {
      setUrl('')
      setName('')
      setAdding(null)
    }
  }

  async function pick(kind: PathType): Promise<void> {
    // 취소하면 아무것도 저장되지 않는다(성공이지만 데이터가 null).
    const result = await handle(() => window.octopus.shortcuts.pickPath(kind))
    if (result?.ok) setAdding(null)
  }

  async function saveRename(): Promise<void> {
    if (!renaming) return
    const result = await handle(() => window.octopus.shortcuts.rename(renaming.id, renaming.text))
    if (result?.ok) setRenaming(null)
  }

  async function remove(id: string): Promise<void> {
    const result = await handle(() => window.octopus.shortcuts.remove(id))
    if (result && (result.ok || result.error.code === 'not_found')) setConfirmingId(null)
  }

  const list = shortcuts ?? []
  const buttonClass = 'min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] text-ink hover:bg-black/5 disabled:opacity-50'

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {loadFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2.5 py-2">
          <span className="min-w-0 flex-1 text-xs text-red-800">{t.loadFailed}</span>
          <button type="button" onClick={onChanged} className={buttonClass}>
            {t.retry}
          </button>
        </div>
      )}

      {shortcuts && !loadFailed && list.length === 0 && adding === null && <p className="text-sm text-[#5e5d58]">{t.empty}</p>}

      {managing && list.length > 0 && <p className="text-xs text-[#5e5d58]">{t.editHint}</p>}

      <ul className={managing ? 'flex flex-col gap-1.5' : 'grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2'}>
        {list.map((shortcut, index) => (
          <li key={shortcut.id} className="min-w-0 rounded-lg border border-line">
            {managing ? (
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                <span className="text-accent">
                  <Icon name={iconOf(shortcut)} size={18} />
                </span>
                {renaming?.id === shortcut.id ? (
                  <form
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
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
                      className="min-w-24 flex-1 rounded-md border border-[#dad9d4] px-2 py-1 text-sm outline-none focus:border-accent"
                    />
                    <button type="submit" disabled={pending} className={buttonClass}>
                      {pending ? t.saving : t.save}
                    </button>
                    <button type="button" disabled={pending} onClick={() => setRenaming(null)} className={buttonClass}>
                      {t.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <span title={`${shortcut.label}\n${shortcut.target}`} className={`flex-1 basis-24 text-sm ${wrap}`}>
                      {shortcut.label}
                    </span>
                    <span className="flex flex-wrap items-center gap-0.5">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setConfirmingId(null)
                          setRenaming({ id: shortcut.id, text: shortcut.label })
                        }}
                        className="rounded px-2 py-1 text-xs text-ink hover:bg-black/5 disabled:opacity-50"
                      >
                        {t.rename}
                      </button>
                      <button
                        type="button"
                        aria-label={t.moveUp(shortcut.label)}
                        disabled={index === 0 || pending}
                        onClick={() => void handle(() => window.octopus.shortcuts.move(shortcut.id, 'up'))}
                        className="rounded p-1 text-ink hover:bg-black/5 disabled:opacity-30"
                      >
                        <Icon name="up" size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={t.moveDown(shortcut.label)}
                        disabled={index === list.length - 1 || pending}
                        onClick={() => void handle(() => window.octopus.shortcuts.move(shortcut.id, 'down'))}
                        className="rounded p-1 text-ink hover:bg-black/5 disabled:opacity-30"
                      >
                        <Icon name="down" size={16} />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setRenaming(null)
                          setConfirmingId(shortcut.id)
                        }}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t.remove}
                      </button>
                    </span>
                  </>
                )}
                {confirmingId === shortcut.id && (
                  <div role="alertdialog" aria-label={t.confirmRemove} className="flex w-full flex-wrap items-center gap-2 rounded-md bg-red-50 px-2 py-1.5">
                    <span className="flex-1 text-xs text-red-800">{t.confirmRemove}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void remove(shortcut.id)}
                      className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
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
                className="flex min-h-[84px] w-full min-w-0 flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-center hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon name={iconOf(shortcut)} size={20} />
                </span>
                <span title={shortcut.label} className={`line-clamp-2 w-full text-[13px] leading-tight text-ink ${wrap}`}>
                  {shortcut.label}
                </span>
                <span className="text-[11px] text-[#5e5d58]">{kindOf(shortcut)}</span>
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
          <button type="button" disabled={pending} onClick={() => void pick('file')} className={buttonClass}>
            {t.addFile}
          </button>
          <button type="button" disabled={pending} onClick={() => void pick('folder')} className={buttonClass}>
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
            className="min-h-9 min-w-0 rounded-lg border border-[#dad9d4] px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <input
            value={name}
            aria-label={t.nameLabel}
            placeholder={t.nameLabel}
            onChange={(event) => setName(event.target.value)}
            className="min-h-9 min-w-0 rounded-lg border border-[#dad9d4] px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="submit"
              disabled={pending}
              className="min-h-9 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
            >
              {pending ? t.saving : t.submit}
            </button>
            <button type="button" disabled={pending} onClick={() => setAdding(null)} className={buttonClass}>
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

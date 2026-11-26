import { useEffect, useRef, useState } from 'react'
import type { UpdateState, UpdateStatus } from '../../shared/update/types'
import { ko } from '../i18n/ko'
import { Icon } from '../ui/Icon'
import { useUpdate, type UpdateControls } from '../update/useUpdate'

const t = ko.notices

const UPDATE_SHOWN: readonly UpdateStatus[] = ['available', 'downloading', 'ready']

/**
 * 제목 줄 왼쪽의 알림 표시(ATDT 의 종 알림과 같은 자리·모양). 알림이 있을 때만 보인다.
 * 누르면 바로 아래에 작은 목록이 열리고, 알림마다 그 안에서 바로 처리한다(업데이트: 받기 → 다시 시작해서 설치).
 * [나중에]는 지금 단계의 알림만 치운다. 다음 단계(받기 완료)가 되면 다시 나타난다.
 */
export function NoticeBell() {
  const update = useUpdate()
  const [laterAt, setLaterAt] = useState<UpdateStatus | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const updateNotice = update.state !== null && UPDATE_SHOWN.includes(update.state.status) && laterAt !== update.state.status ? update.state : null
  const count = updateNotice ? 1 : 0

  // 바깥을 누르거나 Esc 로 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (count === 0) setOpen(false)
  }, [count])

  if (count === 0) return null

  return (
    <div ref={rootRef} className="app-no-drag relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={t.buttonLabel(count)}
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        className="flex items-center gap-1 rounded-full bg-[#fdeccb] px-2 py-0.5 text-xs font-semibold text-[#7a4a00] hover:bg-[#fbdfa8]"
      >
        <Icon name="bell" size={14} />
        {t.button(count)}
      </button>
      {open && (
        <div role="dialog" aria-label={t.panel} className="absolute left-0 top-8 z-[70] w-72 rounded-xl border border-line bg-white p-1.5 text-ink shadow-lg">
          <ul>
            {updateNotice && (
              <li>
                <UpdateNotice state={updateNotice} controls={update} onLater={() => setLaterAt(updateNotice.status)} />
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function UpdateNotice({ state, controls, onLater }: { state: UpdateState; controls: UpdateControls; onLater: () => void }) {
  const u = t.update
  const version = state.version ?? ''
  const percent = state.percent ?? 0
  const primary = 'min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong'
  const later = (
    <button type="button" onClick={onLater} className="min-h-8 rounded-lg px-2.5 text-sm text-[#5e5d58] hover:bg-black/5">
      {t.later}
    </button>
  )

  return (
    <div className="rounded-lg p-2.5">
      <p className="text-sm font-semibold">
        {state.status === 'available' ? u.available(version) : state.status === 'downloading' ? u.downloading(version) : u.ready(version)}
      </p>

      {state.status === 'available' && state.notes && <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-[#5e5d58]">{state.notes}</p>}
      {state.status === 'ready' && <p className="mt-1 text-xs text-[#5e5d58]">{u.readyBody}</p>}
      {state.status === 'downloading' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[#5e5d58]">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ecebe6]" role="progressbar" aria-label={ko.settings.update.progress} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          {percent}%
        </div>
      )}

      {state.status !== 'downloading' && (
        <div className="mt-2 flex justify-end gap-1.5">
          {later}
          {state.status === 'available' ? (
            <button type="button" onClick={controls.download} className={primary}>
              {u.download}
            </button>
          ) : (
            <button type="button" onClick={controls.install} className={primary}>
              {u.install}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

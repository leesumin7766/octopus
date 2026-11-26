import { useState } from 'react'
import type { UpdateStatus } from '../../shared/update/types'
import { ko } from '../i18n/ko'
import { Icon } from '../ui/Icon'
import { useUpdate } from './useUpdate'

const t = ko.settings.update
const c = t.chip

const SHOWN: readonly UpdateStatus[] = ['available', 'downloading', 'ready']

/**
 * 제목 줄 왼쪽의 한 줄짜리 업데이트 알림(ATDT 의 팝업 대신). 화면 자리를 차지하지 않는다.
 * 새 버전 있음 → [받기], 받는 중 → 진행률, 받음 → [다시 시작해서 설치]. × 로 닫으면 다음 단계가 될 때까지 숨긴다.
 * 노트·자세한 내용은 설정 > 업데이트에 있다.
 */
export function UpdateChip() {
  const { state, download, install } = useUpdate()
  const [dismissedAt, setDismissedAt] = useState<UpdateStatus | null>(null)

  if (!state || !SHOWN.includes(state.status) || dismissedAt === state.status) return null
  const version = state.version ?? ''
  const percent = state.percent ?? 0
  const primary = 'rounded-full bg-accent px-2.5 py-0.5 font-semibold text-white hover:bg-accent-strong'

  return (
    <div
      role="group"
      aria-label={c.label}
      className="app-no-drag flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-[#c9c7f0] bg-accent-soft pl-3 pr-1 text-xs text-accent-strong"
    >
      {state.status === 'available' && (
        <>
          <span className="whitespace-nowrap font-semibold" title={state.notes}>
            {c.available(version)}
          </span>
          <button type="button" onClick={download} className={primary}>
            {c.download}
          </button>
        </>
      )}
      {state.status === 'downloading' && (
        <span role="status" className="flex items-center gap-2 whitespace-nowrap pr-1 font-semibold">
          {c.downloading(percent)}
          <span className="h-1 w-12 overflow-hidden rounded-full bg-white" role="progressbar" aria-label={t.progress} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </span>
        </span>
      )}
      {state.status === 'ready' && (
        <button type="button" onClick={install} title={`${t.status.ready(version)} ${t.installHelp}`} className={`${primary} whitespace-nowrap`}>
          {c.install}
        </button>
      )}
      <button
        type="button"
        aria-label={c.dismiss}
        title={c.dismiss}
        onClick={() => setDismissedAt(state.status)}
        className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

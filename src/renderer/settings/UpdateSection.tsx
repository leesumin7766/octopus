import type { UpdateState } from '../../shared/update/types'
import { ko } from '../i18n/ko'
import { UnsavedStrip } from '../leaveGuard'
import { useGuardedInstall } from '../update/useGuardedInstall'
import { useUpdate } from '../update/useUpdate'

const t = ko.settings.update

function statusText(state: UpdateState): string {
  const version = state.version ?? ''
  switch (state.status) {
    case 'available':
      return t.status.available(version)
    case 'downloading':
      return t.status.downloading(version)
    case 'ready':
      return t.status.ready(version)
    case 'error':
      return `${t.status.error} ${t.errors[state.error ?? 'other']}`
    default:
      return t.status[state.status]
  }
}

/** 설정 > 업데이트: 현재 버전, 지금 확인, 받기, 다시 시작해서 설치, 바뀐 점. */
export function UpdateSection() {
  const { state, actionError, pending, check, download, install } = useUpdate()
  const busy = state?.status === 'checking' || state?.status === 'downloading' || pending.includes('check')
  const guarded = useGuardedInstall(install)
  const retry = actionError === 'check' ? check : actionError === 'download' ? download : install
  const canCheck = !!state && state.status !== 'disabled' && state.status !== 'ready'
  const showNotes = !!state?.notes && (state.status === 'available' || state.status === 'downloading' || state.status === 'ready')
  const primary = 'min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong'

  return (
    <section aria-label={t.title} className="mt-4 max-w-xl rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold">{t.title}</h2>
        <span className="text-[13px] text-[#5e5d58]">
          {t.current} <b className="text-ink">{state?.current || '…'}</b>
        </span>
        <span className="flex-1" />
        {state?.status === 'available' && (
          <button type="button" disabled={pending.includes('download')} onClick={download} className={primary}>
            {t.download}
          </button>
        )}
        {state?.status === 'ready' && (
          <button type="button" disabled={pending.includes('install')} onClick={guarded.requestInstall} className={primary}>
            {t.install}
          </button>
        )}
        {canCheck && (
          <button
            type="button"
            disabled={busy}
            onClick={check}
            className="min-h-9 rounded-lg border border-[#dad9d4] bg-white px-3 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.check}
          </button>
        )}
      </div>

      {guarded.asking && (
        <div className="mt-3">
          <UnsavedStrip title={ko.home.localCalendar.discardTitle} onKeep={guarded.keep} onDiscard={guarded.discard} />
        </div>
      )}

      {state && (
        <p role={state.status === 'error' ? 'alert' : 'status'} className={`mt-2 text-[13px] ${state.status === 'error' ? 'text-[#b3261e]' : 'text-[#4a4945]'}`}>
          {statusText(state)}
        </p>
      )}
      {state?.status === 'downloading' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#ecebe6]" role="progressbar" aria-label={t.progress} aria-valuenow={state.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${state.percent ?? 0}%` }} />
        </div>
      )}
      {actionError && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[#b3261e]">
          <span>{t.failed[actionError]}</span>
          <button
            type="button"
            disabled={pending.includes(actionError)}
            onClick={retry}
            className="min-h-8 rounded-lg border border-[#dad9d4] bg-white px-2.5 text-sm text-ink hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.retry}
          </button>
        </p>
      )}
      {state?.status === 'ready' && <p className="mt-1 text-xs text-[#5e5d58]">{t.installHelp}</p>}
      {showNotes && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] text-[#4a4945]">{t.notes}</summary>
          <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-page p-2 font-sans text-xs text-[#4a4945]">{state?.notes}</pre>
        </details>
      )}
    </section>
  )
}

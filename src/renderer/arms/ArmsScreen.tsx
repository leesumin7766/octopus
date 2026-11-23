import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArmInfo } from '../../shared/arms/types'
import type { IpcError } from '../../shared/ipc'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'

const t = ko.arms

/** 상태가 바뀌었는지(백그라운드 가져오기 실패 등) 가끔 다시 읽는다. */
const POLL_MS = 5000

const DOT: Record<ArmInfo['status']['state'], string> = {
  off: 'bg-[#9a9993]',
  connecting: 'bg-[#c98a12]',
  on: 'bg-[#1e7a4c]',
  error: 'bg-[#c0392b]'
}

interface ArmCardProps {
  arm: ArmInfo
  busy: boolean
  confirming: boolean
  onConnect: () => void
  onAskDisconnect: () => void
  onCancelDisconnect: () => void
  onDisconnect: () => void
  onAutoAccept: (on: boolean) => void
}

function ArmCard({ arm, busy, confirming, onConnect, onAskDisconnect, onCancelDisconnect, onDisconnect, onAutoAccept }: ArmCardProps) {
  const { state, reason } = arm.status
  const connecting = busy || state === 'connecting'
  const primary = 'min-h-9 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-40'

  return (
    <article aria-label={t.cardLabel(arm.name)} className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#edece7] text-sm font-bold text-ink">
          {Array.from(arm.name)[0]}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[15px] font-semibold">{arm.name}</h3>
          <span className="flex items-center gap-1.5 text-xs text-[#4a4945]">
            <span aria-hidden="true" className={`size-2 rounded-full ${DOT[connecting ? 'connecting' : state]}`} />
            <span role="status">{connecting ? t.statuses.connecting : t.statuses[state]}</span>
          </span>
        </div>
      </div>

      {arm.description && <p className="text-[13px] leading-relaxed text-[#4a4945]">{arm.description}</p>}

      {state === 'error' && reason && (
        <p role="alert" className="rounded-lg bg-[#fbeceb] px-3 py-2 text-[13px] text-[#7d2a21]">
          {reason}
        </p>
      )}

      <ul aria-label="능력" className="flex flex-wrap gap-1.5">
        {arm.capabilities.map((capability) => (
          <li key={capability} className="rounded-full bg-[#f0efeb] px-2 py-1 text-xs text-[#4a4945]">
            {t.capabilities[capability] ?? capability}
          </li>
        ))}
      </ul>

      {state === 'on' && arm.capabilities.includes('tasks.import') && (
        <label className="flex items-center gap-2 text-[13px] text-[#4a4945]">
          <input type="checkbox" checked={arm.autoAccept} onChange={(event) => onAutoAccept(event.target.checked)} className="size-4" />
          {t.autoAccept}
        </label>
      )}

      {confirming ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-page p-3 text-[13px]">
          <span>{t.disconnectConfirm}</span>
          <span className="flex gap-2">
            <button type="button" onClick={onDisconnect} className={`${primary} bg-[#c0392b] text-white`}>
              {t.disconnectYes}
            </button>
            <button type="button" onClick={onCancelDisconnect} className={`${primary} border border-line bg-white font-normal`}>
              {t.disconnectNo}
            </button>
          </span>
        </div>
      ) : (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-[#5e5d58]">{t.auth[arm.auth] ?? arm.auth}</span>
          <span className="flex gap-1.5">
            {(state === 'on' || state === 'error') && (
              <button type="button" onClick={onAskDisconnect} className={`${primary} border border-line bg-white font-normal hover:bg-black/5`}>
                {t.disconnect}
              </button>
            )}
            {state !== 'on' && (
              <button type="button" disabled={connecting} onClick={onConnect} className={`${primary} bg-accent text-white hover:bg-accent-strong`}>
                {connecting ? t.connecting : state === 'error' ? t.reconnect : t.connect}
              </button>
            )}
          </span>
        </div>
      )}
    </article>
  )
}

/** Arms 화면: 등록된 Arm 만 카드로 보여 주고 연결·끊기를 한다. */
export function ArmsScreen() {
  const [arms, setArms] = useState<ArmInfo[] | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    const result = await window.octopus.arms.list()
    if (!mounted.current) return
    if (result.ok) setArms(result.data)
    else setError(result.error)
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [load])

  /** 연결·끊기·설정 변경 하나를 하고, 돌아온 Arm 정보로 그 카드만 바꾼다. */
  async function act(id: string, call: () => Promise<{ ok: true; data: ArmInfo } | { ok: false; error: IpcError }>): Promise<void> {
    setBusyId(id)
    setError(null)
    const result = await call()
    if (!mounted.current) return
    setBusyId(null)
    if (result.ok) setArms((current) => current?.map((arm) => (arm.id === id ? result.data : arm)) ?? current)
    else setError(result.error)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-page px-5 py-4 text-ink">
      <h1 className="flex items-baseline gap-2.5 text-lg font-semibold">
        {t.title}
        <span className="text-sm font-medium text-[#5e5d58]">{t.subtitle}</span>
      </h1>
      <p className="mb-4 mt-1 max-w-2xl text-[13px] text-[#4a4945]">{t.intro}</p>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {arms === null ? null : arms.length === 0 ? (
        <p className="max-w-xl rounded-xl border border-line bg-white p-4 text-sm text-[#4a4945]">{t.empty}</p>
      ) : (
        <section aria-label={t.listLabel} className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {arms.map((arm) => (
            <ArmCard
              key={arm.id}
              arm={arm}
              busy={busyId === arm.id}
              confirming={confirmId === arm.id}
              onConnect={() => void act(arm.id, () => window.octopus.arms.connect(arm.id))}
              onAskDisconnect={() => setConfirmId(arm.id)}
              onCancelDisconnect={() => setConfirmId(null)}
              onDisconnect={() => {
                setConfirmId(null)
                void act(arm.id, () => window.octopus.arms.disconnect(arm.id))
              }}
              onAutoAccept={(on) => void act(arm.id, () => window.octopus.arms.setAutoAccept(arm.id, on))}
            />
          ))}
        </section>
      )}

      <section aria-label={t.mcp.title} className="mt-6 max-w-2xl rounded-xl border border-line bg-white p-4">
        <h2 className="text-[15px] font-bold">{t.mcp.title}</h2>
        <p className="mt-1 text-[13px] text-[#5e5d58]">{t.mcp.soon}</p>
      </section>
    </div>
  )
}

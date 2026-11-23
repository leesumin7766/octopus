import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArmInfo } from '../../shared/arms/types'
import type { IpcError } from '../../shared/ipc'
import { ErrorBanner } from '../ErrorBanner'
import { safeInvoke } from '../safeInvoke'
import { McpSection } from './McpSection'
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

/** 고급: 내 OAuth 클라이언트 쓰기. 접어 둔 곳에만 있고, 저장한 값은 다시 보여 주지 않는다. */
function AdvancedClient({ arm, onSave }: { arm: ArmInfo; onSave: (client: { clientId: string; clientSecret?: string } | null) => Promise<string | null> }) {
  const a = t.advanced
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const input = 'min-h-9 w-full rounded-lg border border-[#dad9d4] bg-white px-2 text-sm outline-none focus:border-accent'

  async function save(): Promise<void> {
    const problem = await onSave({ clientId: clientId.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) })
    setMessage(problem)
    if (!problem) {
      setClientId('')
      setClientSecret('')
    }
  }

  return (
    <details className="rounded-lg border border-line bg-page px-3 py-2 text-[13px]">
      <summary className="cursor-pointer font-medium">{a.summary}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <h4 className="font-semibold">{a.title}</h4>
        <p className="text-xs text-[#5e5d58]">{a.help}</p>
        <label className="flex flex-col gap-1">
          {a.clientId}
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {a.clientSecret}
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" className={input} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={clientId.trim() === ''} onClick={() => void save()} className="min-h-9 rounded-lg bg-accent px-3 font-semibold text-white disabled:opacity-40">
            {a.save}
          </button>
          {arm.advanced?.clientIdSaved && (
            <>
              <span role="status" className="font-semibold text-[#2e7d4f]">
                {a.saved}
              </span>
              <button type="button" onClick={() => void onSave(null)} className="min-h-9 rounded-lg border border-line bg-white px-3">
                {a.clear}
              </button>
            </>
          )}
        </div>
        {message && (
          <p role="alert" className="text-[#a33a2d]">
            {message}
          </p>
        )}
      </div>
    </details>
  )
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
  onSaveClient: (client: { clientId: string; clientSecret?: string } | null) => Promise<string | null>
  onOpenSettings?: () => void
}

function ArmCard({ arm, busy, confirming, onConnect, onAskDisconnect, onCancelDisconnect, onDisconnect, onAutoAccept, onSaveClient, onOpenSettings }: ArmCardProps) {
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

      {arm.unavailableReason && (
        <p role="status" className="rounded-lg bg-[#fff6e0] px-3 py-2 text-[13px] text-[#6b4a00]">
          {arm.unavailableReason}
        </p>
      )}

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

      {arm.advanced && <AdvancedClient arm={arm} onSave={onSaveClient} />}

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
            {arm.settingsScreen && onOpenSettings && (
              <button type="button" onClick={onOpenSettings} className={`${primary} border border-line bg-white font-normal hover:bg-black/5`}>
                {t.settings}
              </button>
            )}
            {(state === 'on' || state === 'error') && (
              <button type="button" onClick={onAskDisconnect} className={`${primary} border border-line bg-white font-normal hover:bg-black/5`}>
                {t.disconnect}
              </button>
            )}
            {state !== 'on' && (
              <button type="button" disabled={connecting || !!arm.unavailableReason} onClick={onConnect} className={`${primary} bg-accent text-white hover:bg-accent-strong`}>
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
/** scrollToMcp: 개발용 캡처에서 MCP 구역이 보이도록 처음에 그쪽으로 내린다. */
export function ArmsScreen({ scrollToMcp = false, onOpenSettings }: { scrollToMcp?: boolean; onOpenSettings?: (screen: string) => void }) {
  const [arms, setArms] = useState<ArmInfo[] | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    const result = await safeInvoke(() => window.octopus.arms.list())
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

  // MCP 서버는 아래 "MCP 서버 꽂기" 구역에서 따로 다룬다(카드로 보이지 않는다).
  const visibleArms = (arms ?? []).filter((arm) => arm.auth !== 'mcp')

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-page px-5 py-4 text-ink">
      <h1 className="flex items-baseline gap-2.5 text-lg font-semibold">
        {t.title}
        <span className="text-sm font-medium text-[#5e5d58]">{t.subtitle}</span>
      </h1>
      <p className="mb-4 mt-1 max-w-2xl text-[13px] text-[#4a4945]">{t.intro}</p>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {arms === null ? null : visibleArms.length === 0 ? (
        <p className="max-w-xl rounded-xl border border-line bg-white p-4 text-sm text-[#4a4945]">{t.empty}</p>
      ) : (
        <section aria-label={t.listLabel} className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {visibleArms.map((arm) => (
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
              onOpenSettings={arm.settingsScreen && onOpenSettings ? () => onOpenSettings(arm.settingsScreen as string) : undefined}
              onAutoAccept={(on) => void act(arm.id, () => window.octopus.arms.setAutoAccept(arm.id, on))}
              onSaveClient={async (client) => {
                const result = await window.octopus.arms.setClient(arm.id, client)
                if (result.ok) {
                  setArms((current) => current?.map((a) => (a.id === arm.id ? result.data : a)) ?? current)
                  return null
                }
                const field = result.error.fields?.[0]
                return field === 'clientSecret' ? t.advanced.errors.clientSecret : t.advanced.errors.clientId
              }}
            />
          ))}
        </section>
      )}

      <McpSection scrollIntoViewOnMount={scrollToMcp} armsReady={arms !== null} />
    </div>
  )
}

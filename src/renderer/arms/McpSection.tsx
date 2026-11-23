import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpServerInfo, McpTransport } from '../../shared/mcp/types'
import type { IpcError } from '../../shared/ipc'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'

const t = ko.arms.mcp
const INPUT = 'min-h-9 w-full min-w-0 rounded-lg border border-[#dad9d4] bg-white px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'
const BTN = 'min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] hover:bg-black/5 disabled:opacity-40'
const POLL_MS = 5000

const DOT = { off: 'bg-[#9a9993]', connecting: 'bg-[#c98a12]', on: 'bg-[#1e7a4c]', error: 'bg-[#c0392b]' } as const

interface EnvRow {
  name: string
  value: string
}

function fieldError(error: IpcError): string | null {
  if (error.code !== 'invalid_input') return null
  const field = error.fields?.[0]
  return field && field in t.errors ? t.errors[field as keyof typeof t.errors] : null
}

/** Arms 화면의 "MCP 서버 꽂기": 추가 폼과 서버 목록. 환경 변수 값은 입력 후 바로 비우고 다시 보여 주지 않는다. */
export function McpSection({ scrollIntoViewOnMount = false, armsReady = true }: { scrollIntoViewOnMount?: boolean; armsReady?: boolean }) {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<McpTransport>('http')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState<EnvRow[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const mounted = useRef(true)
  const sectionRef = useRef<HTMLElement>(null)

  // 개발용 캡처에서만: 목록이 채워진 뒤에 이 구역이 보이도록 내린다.
  useEffect(() => {
    // Arm 카드가 먼저 자리를 잡은 뒤에 내려야 이 구역이 보인다.
    if (scrollIntoViewOnMount && servers !== null && armsReady) sectionRef.current?.scrollIntoView?.({ block: 'start' })
  }, [scrollIntoViewOnMount, servers, armsReady])

  const load = useCallback(async (): Promise<void> => {
    const result = await window.octopus.mcp.list()
    if (!mounted.current) return
    if (result.ok) setServers(result.data)
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

  async function submit(): Promise<void> {
    setFormError(null)
    setBusy(true)
    const input =
      kind === 'http'
        ? { name, transport: 'http' as const, url: url.trim() }
        : {
            name,
            transport: 'stdio' as const,
            command: command.trim(),
            args: args.split(/\r?\n/).filter((line) => line !== ''),
            env: env.filter((row) => row.name.trim() !== '').map((row) => ({ name: row.name.trim(), value: row.value }))
          }
    const result = await window.octopus.mcp.add(input)
    if (!mounted.current) return
    setBusy(false)
    if (!result.ok) return void setFormError(fieldError(result.error) ?? ko.tasks.errors[result.error.code])
    // 저장했다: 입력(특히 환경 변수 값)을 비운다.
    setName('')
    setUrl('')
    setCommand('')
    setArgs('')
    setEnv([])
    await load()
  }

  async function act(id: string, call: () => Promise<{ ok: true; data: unknown } | { ok: false; error: IpcError }>): Promise<void> {
    setWorkingId(id)
    setError(null)
    const result = await call()
    if (!mounted.current) return
    setWorkingId(null)
    if (!result.ok) setError(result.error)
    await load()
  }

  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <section ref={sectionRef} aria-label={t.title} className="mt-6 max-w-3xl rounded-xl border border-line bg-white p-4">
      <h2 className="text-[15px] font-bold">{t.title}</h2>
      <p className="mb-3 mt-1 text-[13px] text-[#5e5d58]">{t.help}</p>

      <form
        aria-label={t.add}
        className="mb-4 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-32 flex-col gap-1 text-[13px] text-[#4a4945]">
            {t.kindLabel}
            <select value={kind} onChange={(event) => setKind(event.target.value as McpTransport)} className={INPUT}>
              <option value="http">{t.kinds.http}</option>
              <option value="stdio">{t.kinds.stdio}</option>
            </select>
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-[13px] text-[#4a4945]">
            {t.nameLabel}
            <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT} />
          </label>
        </div>

        {kind === 'http' ? (
          <label className="flex flex-col gap-1 text-[13px] text-[#4a4945]">
            {t.urlLabel}
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t.urlPlaceholder} spellCheck={false} className={INPUT} />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[13px] text-[#4a4945]">
              {t.commandLabel}
              <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t.commandPlaceholder} spellCheck={false} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-[#4a4945]">
              {t.argsLabel}
              <textarea value={args} onChange={(event) => setArgs(event.target.value)} placeholder={t.argsPlaceholder} rows={3} spellCheck={false} className={`${INPUT} font-mono`} />
            </label>
            <fieldset className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
              <legend className="px-1 text-[13px] text-[#4a4945]">{t.envTitle}</legend>
              <p className="text-xs text-[#5e5d58]">{t.envHelp}</p>
              {env.map((row, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    aria-label={`${t.envName} ${index + 1}`}
                    value={row.name}
                    onChange={(event) => setEnv((rows) => rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))}
                    placeholder={t.envName}
                    spellCheck={false}
                    className={INPUT}
                  />
                  <input
                    aria-label={`${t.envValue} ${index + 1}`}
                    type="password"
                    autoComplete="off"
                    value={row.value}
                    onChange={(event) => setEnv((rows) => rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))}
                    placeholder={t.envValue}
                    className={INPUT}
                  />
                  <button type="button" aria-label={`${t.envRemove} ${index + 1}`} onClick={() => setEnv((rows) => rows.filter((_, i) => i !== index))} className={BTN}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setEnv((rows) => [...rows, { name: '', value: '' }])} className={`${BTN} self-start`}>
                {t.envAdd}
              </button>
            </fieldset>
          </>
        )}

        {formError && (
          <p role="alert" className="text-[13px] text-[#a33a2d]">
            {formError}
          </p>
        )}
        <button type="submit" disabled={busy} className="min-h-10 self-start rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40">
          {busy ? t.adding : t.add}
        </button>
      </form>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {servers !== null && servers.length === 0 && <p className="text-[13px] text-[#5e5d58]">{t.empty}</p>}
      {servers !== null && servers.length > 0 && (
        <ul aria-label={t.list} className="flex flex-col divide-y divide-[#efeeea]">
          {servers.map((server) => (
            <li key={server.id} aria-label={t.serverLabel(server.name)} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[workingId === server.id ? 'connecting' : server.status.state]}`} />
                <span className="text-sm font-semibold">{server.name}</span>
                <span className="text-xs text-[#5e5d58]">{ko.arms.statuses[workingId === server.id ? 'connecting' : server.status.state]}</span>
                {server.status.state === 'on' && <span className="text-xs text-[#5e5d58]">{t.toolCount(server.tools.length)}</span>}
                <span className="ml-auto flex gap-1.5">
                  {server.status.state === 'on' && (
                    <button type="button" aria-expanded={open.has(server.id)} onClick={() => toggle(server.id)} className={BTN}>
                      {open.has(server.id) ? t.hideTools : t.showTools}
                    </button>
                  )}
                  <button type="button" disabled={workingId === server.id} onClick={() => void act(server.id, () => window.octopus.mcp.reconnect(server.id))} className={BTN}>
                    {t.reconnect}
                  </button>
                  <button type="button" onClick={() => setConfirmId(server.id)} className={BTN}>
                    {t.remove}
                  </button>
                </span>
              </div>
              <p className="break-all font-mono text-xs text-[#5e5d58]">{server.target}</p>
              {server.envKeys.length > 0 && <p className="text-xs text-[#5e5d58]">{t.envNames(server.envKeys)}</p>}
              {server.status.state === 'error' && server.status.reason && (
                <p role="alert" className="rounded-lg bg-[#fbeceb] px-3 py-2 text-[13px] text-[#7d2a21]">
                  {server.status.reason}
                </p>
              )}
              {confirmId === server.id && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-page p-3 text-[13px]">
                  <span>{t.removeConfirm}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmId(null)
                      void act(server.id, () => window.octopus.mcp.remove(server.id))
                    }}
                    className="min-h-9 rounded-lg bg-[#c0392b] px-3 text-white"
                  >
                    {t.removeYes}
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className={BTN}>
                    {t.removeNo}
                  </button>
                </div>
              )}
              {open.has(server.id) && (
                <ul aria-label={`${server.name} ${t.showTools}`} className="flex flex-col gap-1 rounded-lg bg-page p-2">
                  {server.tools.length === 0 && <li className="text-xs text-[#5e5d58]">{t.noTools}</li>}
                  {server.tools.map((tool) => (
                    <li key={tool.name} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                      <code className="font-mono text-xs">{tool.name}</code>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${tool.readOnly ? 'bg-[#e3f3ea] text-[#1e6b43]' : 'bg-[#fff2d6] text-[#7a5200]'}`}>{tool.readOnly ? t.readOnly : t.write}</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-[#4a4945]">{tool.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

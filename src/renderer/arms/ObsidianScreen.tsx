import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError } from '../../shared/ipc'
import type { ObsidianConfigPatch, ObsidianMode, ObsidianState } from '../../shared/obsidian/types'
import { normalizeExportPath } from '../../shared/validation/obsidian'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'

const t = ko.obsidian
const MODES: ObsidianMode[] = ['off', 'export', 'both']
const BTN = 'min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] hover:bg-black/5 disabled:opacity-40'

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 옵시디언 설정 화면: 쓰는 방식, 내보낼 곳, 일일노트 링크, 마지막 내보낸 시각, 동기화 점검, 오른쪽 미리보기.
 * vault 폴더는 main 의 대화상자로만 정해지고, 미리보기는 실제 할 일로 만든 내용을 글자로만 보여 준다.
 */
export function ObsidianScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<ObsidianState | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const [file, setFile] = useState('')
  const [fileMessage, setFileMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  const apply = useCallback((next: ObsidianState): void => {
    setState(next)
    setFile((current) => (current === '' ? next.config.file : current))
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const result = await window.octopus.obsidian.state()
    if (!mounted.current) return
    if (result.ok) apply(result.data)
    else setError(result.error)
  }, [apply])

  useEffect(() => {
    mounted.current = true
    void load()
    // 백그라운드 내보내기(할 일 변경·자정)의 결과를 반영한다.
    const timer = window.setInterval(() => void load(), 5000)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [load])

  async function run(call: () => Promise<{ ok: true; data: ObsidianState } | { ok: false; error: IpcError }>): Promise<boolean> {
    setBusy(true)
    setError(null)
    const result = await call()
    if (!mounted.current) return false
    setBusy(false)
    if (result.ok) {
      setState(result.data)
      return true
    }
    setError(result.error)
    return false
  }

  const setConfig = (patch: ObsidianConfigPatch): Promise<boolean> => run(() => window.octopus.obsidian.setConfig(patch))

  async function saveFile(): Promise<void> {
    setFileMessage(null)
    const normalized = normalizeExportPath(file)
    if (!normalized) return void setFileMessage({ ok: false, text: t.fileError })
    if (await setConfig({ file: normalized })) {
      setFile(normalized)
      setFileMessage({ ok: true, text: t.fileSaved })
    } else setFileMessage({ ok: false, text: t.fileError })
  }

  if (!state) {
    return (
      <div className="h-full bg-page px-5 py-4 text-ink">
        {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : <p className="text-sm text-[#5e5d58]">{ko.tasks.loading}</p>}
      </div>
    )
  }

  const connected = state.status.state === 'on' || state.status.state === 'error'
  const enabled = connected && state.config.mode !== 'off'

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-page px-5 py-4 text-ink">
      <button type="button" onClick={onBack} className="mb-1 self-start text-[13px] text-accent hover:underline">
        {t.back}
      </button>
      <h1 className="text-lg font-semibold">{t.title}</h1>
      <p className="mb-4 mt-1 max-w-2xl text-[13px] text-[#4a4945]">{t.intro}</p>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {!connected && <p className="mb-3 max-w-2xl rounded-lg bg-[#fff6e0] px-3 py-2 text-[13px] text-[#6b4a00]">{t.notConnected}</p>}
      {state.status.state === 'error' && state.status.reason && (
        <p role="alert" className="mb-3 max-w-2xl rounded-lg bg-[#fbeceb] px-3 py-2 text-[13px] text-[#7d2a21]">
          {state.status.reason}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label={t.modeTitle} className="rounded-xl border border-line bg-white p-4">
            <h2 className="mb-2 text-[15px] font-bold">{t.modeTitle}</h2>
            <div role="radiogroup" aria-label={t.modeTitle} className="flex flex-col gap-2">
              {MODES.map((mode) => {
                const m = t.modes[mode]
                const selected = state.config.mode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy}
                    onClick={() => void setConfig({ mode })}
                    className={`flex flex-col gap-0.5 rounded-lg border-2 px-3 py-2 text-left disabled:opacity-60 ${selected ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-black/5'}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {m.title}
                      {'recommended' in m && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">{m.recommended}</span>}
                    </span>
                    <span className="text-xs text-[#4a4945]">{m.desc}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {state.config.mode !== 'off' && (
            <section aria-label={t.vaultTitle} className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
              <h2 className="text-[15px] font-bold">{t.vaultTitle}</h2>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-[#5e5d58]">{t.vault}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{state.config.vaultPath || '—'}</span>
                <button type="button" disabled={busy} onClick={() => void run(() => window.octopus.obsidian.changeVault())} className={BTN}>
                  {t.changeVault}
                </button>
              </div>
              {state.config.vaultPath && !state.looksLikeVault && <p className="text-xs text-[#6b4a00]">{t.notVault}</p>}

              <label className="flex flex-col gap-1 text-[13px] text-[#4a4945]">
                {t.fileLabel}
                <span className="flex gap-2">
                  <input
                    value={file}
                    onChange={(event) => setFile(event.target.value)}
                    spellCheck={false}
                    className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#dad9d4] bg-white px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <button type="button" disabled={busy} onClick={() => void saveFile()} className={BTN}>
                    {t.saveFile}
                  </button>
                </span>
              </label>
              {fileMessage && (
                <p role={fileMessage.ok ? 'status' : 'alert'} className={`text-xs ${fileMessage.ok ? 'text-[#2e7d4f]' : 'text-[#a33a2d]'}`}>
                  {fileMessage.text}
                </p>
              )}

              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" checked={state.config.dailyNote} disabled={busy} onChange={(event) => void setConfig({ dailyNote: event.target.checked })} className="mt-0.5 size-4" />
                <span>
                  {t.daily}
                  <br />
                  <span className="text-xs text-[#5e5d58]">{t.dailyHelp}</span>
                </span>
              </label>
              {state.dailyProblem && (
                <p role="status" className="text-xs text-[#6b4a00]">
                  {state.dailyProblem}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="text-[#4a4945]">{state.lastExportAt ? t.lastExport(formatTime(state.lastExportAt)) : t.neverExported}</span>
                <button type="button" disabled={busy || !enabled} onClick={() => void run(() => window.octopus.obsidian.exportNow())} className={BTN}>
                  {busy ? t.exporting : t.exportNow}
                </button>
              </div>
              {state.lastExportError && (
                <p role="alert" className="text-xs text-[#a33a2d]">
                  {state.lastExportError}
                </p>
              )}
            </section>
          )}

          {state.config.mode !== 'off' && state.config.vaultPath && (
            <section aria-label={t.syncTitle} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4">
              <h2 className="text-[15px] font-bold">{t.syncTitle}</h2>
              {!state.git || !state.git.isGit ? (
                <p className="text-[13px] text-[#4a4945]">{t.gitNone}</p>
              ) : state.git.notIgnored.length === 0 ? (
                <p className="text-[13px] text-[#2e7d4f]">{t.gitOk}</p>
              ) : (
                <>
                  <p role="alert" className="text-[13px] text-[#6b4a00]">
                    {t.gitMissing}
                  </p>
                  <button type="button" disabled={busy} onClick={() => void run(() => window.octopus.obsidian.fixGitignore())} className={`${BTN} self-start font-mono`}>
                    {t.gitAdd(state.git.line)}
                  </button>
                  <p className="text-xs text-[#5e5d58]">{t.gitHelp}</p>
                </>
              )}
            </section>
          )}
        </div>

        <section aria-label={t.previewTitle} className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h2 className="text-[15px] font-bold">{t.previewTitle}</h2>
          <p className="mb-2 mt-1 text-xs text-[#5e5d58]">{state.config.mode === 'off' ? '' : state.config.file}</p>
          {state.preview !== null && state.config.mode !== 'off' ? (
            <pre aria-label={t.previewTitle} className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-page p-3 font-mono text-xs leading-relaxed">
              {state.preview}
            </pre>
          ) : (
            <p className="text-[13px] text-[#5e5d58]">{t.noPreview}</p>
          )}
          <p className="mt-2 text-xs text-[#5e5d58]">{t.previewHelp}</p>
        </section>
      </div>
    </div>
  )
}

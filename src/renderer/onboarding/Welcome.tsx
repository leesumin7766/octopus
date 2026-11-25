import { useEffect, useRef, useState } from 'react'
import type { ArmInfo } from '../../shared/arms/types'
import type { IpcError } from '../../shared/ipc'
import { ko } from '../i18n/ko'
import { errorMessage } from '../tasks/errors'
import { QuickInput } from '../tasks/QuickInput'
import { safeInvoke } from '../safeInvoke'

const t = ko.onboarding

interface WelcomeProps {
  /** 끝(홈으로)이나 건너뛰기: 호출하면 앱이 onboarding.done 을 저장하고 홈으로 간다. */
  onDone: () => void
  /** 개발용 캡처에서 특정 단계로 시작한다. */
  initialStep?: 1 | 2 | 3
  /** 개발용 캡처에서 미리 골라 둔 Arm id */
  initialChosen?: string[]
  previewDebounceMs?: number
}

type ConnectState = { phase: 'idle' | 'connecting' | 'on' | 'error'; reason?: string }

/** 연결해 볼 만한 Arm: 실제로 등록된 것만(MCP 서버는 여기 선택지가 아니라 안내 한 줄로만). */
const choosable = (arm: ArmInfo): boolean => arm.auth !== 'mcp'

/**
 * 첫 실행 3단계: 1/3 무엇으로 일하세요? → 2/3 로그인만 하면 됩니다 → 3/3 준비됐습니다.
 * 아무것도 고르지 않아도 다음 → 다음 → 첫 할 일 입력(Enter) 으로 끝낼 수 있고, 어느 단계에서나 건너뛸 수 있다.
 * 계정 없이 이 PC 에만 저장된다.
 */
export function Welcome({ onDone, initialStep = 1, initialChosen = [], previewDebounceMs = 250 }: WelcomeProps) {
  const [step, setStep] = useState<1 | 2 | 3>(initialStep)
  const [arms, setArms] = useState<ArmInfo[] | null>(null)
  const [chosen, setChosen] = useState<string[]>(initialChosen)
  const [connections, setConnections] = useState<Record<string, ConnectState>>(() =>
    Object.fromEntries(initialChosen.map((id) => [id, { phase: 'idle' } as ConnectState]))
  )
  const [added, setAdded] = useState<string | null>(null)
  const [error, setError] = useState<IpcError | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void safeInvoke(() => window.octopus.arms.list()).then((result) => {
      if (mounted.current) setArms(result.ok ? result.data.filter(choosable) : [])
    })
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (step === 3) inputRef.current?.focus()
  }, [step])

  const toggle = (id: string): void => setChosen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  const chosenArms = (arms ?? []).filter((arm) => chosen.includes(arm.id))
  const stateOf = (arm: ArmInfo): ConnectState => connections[arm.id] ?? (arm.status.state === 'on' ? { phase: 'on' } : { phase: 'idle' })

  async function connect(arm: ArmInfo): Promise<void> {
    setConnections((current) => ({ ...current, [arm.id]: { phase: 'connecting' } }))
    const result = await window.octopus.arms.connect(arm.id) // 옵시디언은 여기서 폴더 선택 창이 열린다.
    if (!mounted.current) return
    const next: ConnectState = !result.ok
      ? { phase: 'error', reason: errorMessage(result.error) }
      : result.data.status.state === 'on'
        ? { phase: 'on' }
        : { phase: 'error', reason: result.data.status.reason ?? result.data.unavailableReason }
    setConnections((current) => ({ ...current, [arm.id]: next }))
  }

  async function addFirstTask(text: string): Promise<boolean> {
    const result = await window.octopus.tasks.quickAdd(text)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    setAdded(result.data.title)
    return true
  }

  const allConnected = chosenArms.every((arm) => stateOf(arm).phase === 'on')
  const primary = 'min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong'

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto bg-page px-4 py-8 text-ink">
      <div className="flex w-full max-w-xl flex-col gap-5">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-lg font-bold text-accent">
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M7 13a7 7 0 0 1 14 0v3" />
              <path d="M7 15c0 3-2 4-3 6" />
              <path d="M11 16c0 3-1 5-2 7" />
              <path d="M17 16c0 3 1 5 2 7" />
              <path d="M21 15c0 3 2 4 3 6" />
            </svg>
            {ko.appTitle}
          </span>
          <span className="flex items-center gap-3">
            <span role="status" aria-label={t.progressLabel} className="text-sm text-[#5e5d58]">
              {t.stepLabel(step)}
            </span>
            <button type="button" onClick={onDone} className="rounded px-2 py-1 text-xs text-[#6b6a65] hover:bg-black/5">
              {t.skip}
            </button>
          </span>
        </header>

        <div aria-hidden="true" className="flex gap-1.5">
          {[1, 2, 3].map((n) => (
            <span key={n} data-filled={n <= step} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-accent' : 'bg-[#dad9d4]'}`} />
          ))}
        </div>

        <main className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-6">
          {step === 1 && (
            <>
              <h1 className="text-2xl font-bold">{t.step1.title}</h1>
              <p className="text-sm text-[#4a4945]">{t.step1.body}</p>
              {arms === null ? (
                <p className="text-sm text-[#5e5d58]">{t.step1.loading}</p>
              ) : (
                <div role="group" aria-label={t.step1.group} className="flex flex-col gap-2">
                  {arms.map((arm) => {
                    const blocked = !!arm.unavailableReason
                    const on = chosen.includes(arm.id)
                    return (
                      <button
                        key={arm.id}
                        type="button"
                        aria-pressed={on}
                        aria-disabled={blocked ? 'true' : undefined}
                        disabled={blocked}
                        onClick={() => toggle(arm.id)}
                        className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-4 py-3 text-left ${
                          blocked ? 'cursor-not-allowed border-line bg-page opacity-55' : on ? 'border-accent bg-accent-soft' : 'border-line bg-white hover:bg-black/5'
                        }`}
                      >
                        <span className="text-[15px] font-semibold">{arm.name}</span>
                        <span className="text-xs text-[#4a4945]">{blocked ? arm.unavailableReason : arm.description}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-[#5e5d58]">{t.step1.mcpNote}</p>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-bold">{t.step2.title}</h1>
              <p className="text-sm text-[#4a4945]">{t.step2.body}</p>
              {chosenArms.length === 0 ? (
                <p className="text-sm text-[#5e5d58]">{t.step2.none}</p>
              ) : (
                <ul aria-label={t.step2.list} className="flex flex-col gap-2">
                  {chosenArms.map((arm) => {
                    const state = stateOf(arm)
                    return (
                      <li key={arm.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
                        <span className="min-w-40 flex-1">
                          <span className="block text-[15px] font-semibold">{arm.name}</span>
                          {state.phase === 'error' && state.reason && (
                            <span role="alert" className="mt-0.5 block text-xs text-[#a33a2d]">
                              {state.reason}
                            </span>
                          )}
                        </span>
                        {state.phase === 'on' ? (
                          <span className="text-sm font-semibold text-[#2e7d4f]">{t.step2.connected}</span>
                        ) : (
                          <button
                            type="button"
                            disabled={state.phase === 'connecting'}
                            onClick={() => void connect(arm)}
                            className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
                          >
                            {state.phase === 'connecting' ? t.step2.connecting : state.phase === 'error' ? t.step2.retry : t.step2.connect}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-2xl font-bold">{t.step3.title}</h1>
              <p className="text-sm text-[#4a4945]">{t.step3.body}</p>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.step3.inputLabel}</span>
                <QuickInput inputRef={inputRef} onSubmit={addFirstTask} debounceMs={previewDebounceMs} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-[#a33a2d]">
                  {errorMessage(error)}
                </p>
              )}
              {added !== null && (
                <p role="status" className="text-sm font-semibold text-[#2e7d4f]">
                  {added ? t.step3.added(added) : t.step3.addedGeneric}
                </p>
              )}
            </>
          )}
        </main>

        <footer className="flex items-center gap-3">
          {step > 1 && (
            <button type="button" onClick={() => setStep((step - 1) as 1 | 2)} className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm hover:bg-black/5">
              {t.back}
            </button>
          )}
          {step === 1 && <span className="text-xs text-[#5e5d58]">{t.privacy}</span>}
          <span className="ml-auto" />
          {step < 3 ? (
            <button type="button" onClick={() => setStep((step + 1) as 2 | 3)} className={primary}>
              {step === 2 && !allConnected ? t.nextLater : t.next}
            </button>
          ) : (
            <button
              type="button"
              onClick={onDone}
              className={added !== null ? primary : 'min-h-11 rounded-lg border border-line bg-white px-5 text-sm hover:bg-black/5'}
            >
              {t.home}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

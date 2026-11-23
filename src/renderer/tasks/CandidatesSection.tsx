import { useCallback, useEffect, useRef, useState } from 'react'
import type { InboxCandidate } from '../../shared/arms/types'
import type { IpcError } from '../../shared/ipc'
import { ErrorBanner } from '../ErrorBanner'
import { ko } from '../i18n/ko'
import { safeInvoke } from '../safeInvoke'

const t = ko.tasks.candidates

interface CandidatesSectionProps {
  /** 후보를 받아들여 수신함 할 일이 생겼을 때(목록을 새로 읽으라고 알린다) */
  onChanged: () => void
}

/**
 * 수신함 맨 위의 "들어온 후보". 연결된 도구(Arm)가 보낸 것이라 제목·메모는 외부 데이터다:
 * React 의 글자로만 그리고(HTML 해석 없음), 원본 링크는 main 이 검증해서 연다.
 */
export function CandidatesSection({ onChanged }: CandidatesSectionProps) {
  const [candidates, setCandidates] = useState<InboxCandidate[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<IpcError | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    const [list, arms] = await Promise.all([safeInvoke(() => window.octopus.candidates.list()), safeInvoke(() => window.octopus.arms.list())])
    if (!mounted.current) return
    if (list.ok) setCandidates(list.data)
    if (arms.ok) setNames(Object.fromEntries(arms.data.map((arm) => [arm.id, arm.name])))
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  async function run(call: () => Promise<{ ok: true; data: unknown } | { ok: false; error: IpcError }>, changedTasks: boolean): Promise<void> {
    setError(null)
    const result = await call()
    if (!mounted.current) return
    if (!result.ok) setError(result.error)
    await load()
    if (result.ok && changedTasks) onChanged()
  }

  if (candidates.length === 0 && !error) return null

  const api = window.octopus.candidates
  const btn = 'min-h-8 rounded-lg border border-line bg-white px-2.5 text-[13px] hover:bg-black/5'

  return (
    <section aria-label={t.title(candidates.length)} className="mb-5 rounded-xl border border-[#c9c7f0] bg-accent-soft p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-accent-strong">{t.title(candidates.length)}</h2>
        <span className="min-w-40 flex-1 text-xs text-[#4a4945]">{t.help}</span>
        <button type="button" onClick={() => void run(() => api.acceptAll(), true)} className={btn}>
          {t.acceptAll}
        </button>
        <button type="button" onClick={() => void run(() => api.dismissAll(), false)} className={btn}>
          {t.dismissAll}
        </button>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <ul className="flex flex-col gap-1.5">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2">
            <div className="min-w-48 flex-1">
              <p className="whitespace-pre-wrap break-words text-sm font-medium">{candidate.title}</p>
              <p className="text-xs text-[#5e5d58]">
                {t.from(names[candidate.armId] ?? candidate.armId)}
                {candidate.dueDate ? ` · ${t.due(candidate.dueDate)}` : ''}
              </p>
              {candidate.notes && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[#4a4945]">{candidate.notes}</p>}
            </div>
            {candidate.url && (
              <button type="button" aria-label={t.openLabel(candidate.title)} onClick={() => void run(() => api.openSource(candidate.id), false)} className={btn}>
                {t.openSource}
              </button>
            )}
            <button
              type="button"
              aria-label={t.acceptLabel(candidate.title)}
              onClick={() => void run(() => api.accept(candidate.id), true)}
              className="min-h-8 rounded-lg bg-accent px-2.5 text-[13px] font-semibold text-white hover:bg-accent-strong"
            >
              {t.accept}
            </button>
            <button type="button" aria-label={t.dismissLabel(candidate.title)} onClick={() => void run(() => api.dismiss(candidate.id), false)} className={btn}>
              {t.dismiss}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

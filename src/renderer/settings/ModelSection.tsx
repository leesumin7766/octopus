import { useEffect, useState } from 'react'
import type { LlmProvider, ModelEntry } from '../../shared/command/types'
import { isHttpUrl } from '../../shared/validation/command'
import { useModelStatus } from '../command/useModelStatus'
import { notifyModelsChanged } from '../dataEvents'
import { ko } from '../i18n/ko'
import { errorMessage } from '../tasks/errors'
import { useSetting } from './useSetting'

const t = ko.settings.model

const INPUT =
  'min-h-9 w-full min-w-0 rounded-lg border border-[#dad9d4] bg-white px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'
const BUTTON = 'min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] hover:bg-black/5 disabled:opacity-40'
const PRIMARY = 'min-h-9 shrink-0 whitespace-nowrap rounded-lg bg-accent px-3 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-40'

/**
 * 설정의 "모델 연결" 구역: 지시하기가 쓸 모델과 키.
 * 키는 쓰기 전용이다. 저장하면 입력칸을 비우고 "저장됨"만 보여 준다. 연결 확인(실제 호출) 버튼은 없다.
 */
export function ModelSection() {
  const status = useModelStatus()
  const models = useSetting('command.models')
  const selected = useSetting('command.model')
  const [provider, setProvider] = useState<LlmProvider>('anthropic')
  const [keyInput, setKeyInput] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelName, setModelName] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 설정을 못 읽었을 때(기본값이 아닌 값이 오는 경우)도 화면이 죽지 않게 모양을 확인한다.
  const list: ModelEntry[] = Array.isArray(models.value) ? models.value : []
  const selectedId = typeof selected.value === 'string' ? selected.value : ''
  const custom = list.find((m) => m.provider === 'openai-compatible')

  // 저장된 모델을 읽어 오면 어느 방식을 쓰고 있었는지와 서버 칸을 채운다(처음 한 번).
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    if (filled || models.value === null || selected.value === null) return
    setFilled(true)
    const entries = Array.isArray(models.value) ? models.value : []
    const current = entries.find((m) => m.id === selected.value)
    if (current) setProvider(current.provider)
    const c = entries.find((m) => m.provider === 'openai-compatible')
    if (c) {
      setBaseUrl(c.baseUrl ?? '')
      setModelName(c.model)
    }
  }, [filled, models.value, selected.value])

  async function selectModel(id: string): Promise<void> {
    selected.setLocal(id)
    await window.octopus.settings.set('command.model', id)
    notifyModelsChanged()
  }

  async function saveKey(target: LlmProvider): Promise<void> {
    const result = await window.octopus.command.setKey(target, keyInput)
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error.code === 'invalid_input' ? t.errors.key : errorMessage(result.error) })
      return
    }
    setKeyInput('') // 저장한 키는 화면에 남기지 않는다.
    setMessage({ kind: 'ok', text: t.keySaved })
    notifyModelsChanged()
  }

  async function clearKey(target: LlmProvider): Promise<void> {
    const result = await window.octopus.command.clearKey(target)
    setConfirmClear(false)
    if (!result.ok) return void setMessage({ kind: 'error', text: errorMessage(result.error) })
    setMessage({ kind: 'ok', text: t.keyCleared })
    notifyModelsChanged()
  }

  async function saveServer(): Promise<void> {
    const url = baseUrl.trim()
    const name = modelName.trim()
    if (!isHttpUrl(url)) return void setMessage({ kind: 'error', text: t.errors.baseUrl })
    if (name === '') return void setMessage({ kind: 'error', text: t.errors.modelName })

    const entry: ModelEntry = { id: 'openai-compatible', provider: 'openai-compatible', model: name, label: name, baseUrl: url }
    const next = [...list.filter((m) => m.provider !== 'openai-compatible'), entry]
    const saved = await window.octopus.settings.set('command.models', next)
    if (!saved.ok) return void setMessage({ kind: 'error', text: errorMessage(saved.error) })
    models.setLocal(saved.data)
    if (keyInput.trim() !== '') {
      const keyed = await window.octopus.command.setKey('openai-compatible', keyInput)
      if (!keyed.ok) return void setMessage({ kind: 'error', text: errorMessage(keyed.error) })
      setKeyInput('')
    }
    await selectModel(entry.id)
    setMessage({ kind: 'ok', text: t.serverSaved })
  }

  const hasKey = status.hasKey[provider]
  const anthropicModels = list.filter((m) => m.provider === 'anthropic')
  const anthropicValue = anthropicModels.some((m) => m.id === selectedId) ? selectedId : (anthropicModels[0]?.id ?? '')

  return (
    <section aria-label={t.title} className="mb-4 max-w-xl rounded-xl border border-line bg-white p-4">
      <h2 className="text-[15px] font-bold">{t.title}</h2>
      <p className="mb-3 mt-1 text-[13px] text-[#5e5d58]">{t.help}</p>

      <label className="mb-3 flex items-center gap-3 text-[13px] text-[#5e5d58]">
        <span className="w-24 shrink-0">{t.providerLabel}</span>
        <select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as LlmProvider)
            setKeyInput('')
            setMessage(null)
            setConfirmClear(false)
          }}
          className={INPUT}
        >
          {(Object.keys(t.providers) as LlmProvider[]).map((p) => (
            <option key={p} value={p}>
              {t.providers[p]}
            </option>
          ))}
        </select>
      </label>

      {provider === 'openai-compatible' && (
        <div className="mb-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px] text-[#5e5d58]">
            {t.baseUrlLabel}
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t.baseUrlPlaceholder} spellCheck={false} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[#5e5d58]">
            {t.modelNameLabel}
            <input value={modelName} onChange={(event) => setModelName(event.target.value)} spellCheck={false} className={INPUT} />
          </label>
        </div>
      )}

      <div className="mb-1 flex items-center justify-between text-[13px] text-[#5e5d58]">
        <label htmlFor="model-key">{provider === 'anthropic' ? t.keyLabel : t.keyOptionalLabel}</label>
        <span role="status" className={hasKey ? 'font-semibold text-[#2e7d4f]' : ''}>
          {hasKey ? t.saved : t.notSaved}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id="model-key"
          type="password"
          autoComplete="off"
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          placeholder={t.keyPlaceholder}
          className={INPUT}
        />
        {provider === 'anthropic' ? (
          <button type="button" disabled={keyInput.trim() === ''} onClick={() => void saveKey('anthropic')} className={PRIMARY}>
            {t.saveKey}
          </button>
        ) : (
          <button type="button" onClick={() => void saveServer()} className={PRIMARY}>
            {t.saveServer}
          </button>
        )}
      </div>

      {hasKey &&
        (confirmClear ? (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span>{t.clearConfirm}</span>
            <button type="button" onClick={() => void clearKey(provider)} className="min-h-9 rounded-lg bg-[#c0392b] px-3 text-white">
              {t.clearYes}
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className={BUTTON}>
              {t.clearNo}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} className={`${BUTTON} mt-2`}>
            {t.clearKey}
          </button>
        ))}

      {provider === 'anthropic' && anthropicModels.length > 0 && (
        <label className="mt-3 flex items-center gap-3 text-[13px] text-[#5e5d58]">
          <span className="w-24 shrink-0">{t.modelLabel}</span>
          <select value={anthropicValue} onChange={(event) => void selectModel(event.target.value)} className={INPUT}>
            {anthropicModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {provider === 'openai-compatible' && custom && (
        <p className="mt-2 text-xs text-[#5e5d58]">
          {custom.label} · {custom.baseUrl}
        </p>
      )}

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-[13px] ${message.kind === 'error' ? 'text-[#a33a2d]' : 'text-[#2e7d4f]'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}

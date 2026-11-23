import { DEFAULT_MODELS, type LlmProvider, type ModelEntry } from '../command/types'
import { bad, good, isPlainObject, type Parsed } from './taskIpc'

// 지시하기 입력 검사. 모델 목록(설정)과 IPC 인자.

export const MAX_COMMAND_TEXT = 8000
export const MAX_API_KEY = 500
const MAX_MODELS = 30

export function isProvider(value: unknown): value is LlmProvider {
  return value === 'anthropic' || value === 'openai-compatible'
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function parseEntry(raw: unknown): ModelEntry | null {
  if (!isPlainObject(raw)) return null
  const { id, provider, model, label, baseUrl, effort } = raw
  if (typeof id !== 'string' || id === '' || id.length > 60) return null
  if (!isProvider(provider)) return null
  if (typeof model !== 'string' || model === '' || model.length > 120) return null
  if (typeof label !== 'string' || label === '' || label.length > 80) return null
  const entry: ModelEntry = { id, provider, model, label }
  if (provider === 'openai-compatible') {
    if (typeof baseUrl !== 'string' || !isHttpUrl(baseUrl) || baseUrl.length > 300) return null
    entry.baseUrl = baseUrl
  } else if (baseUrl !== undefined) return null
  if (effort !== undefined) {
    if (provider !== 'anthropic' || (effort !== 'low' && effort !== 'medium' && effort !== 'high')) return null
    entry.effort = effort
  }
  return entry
}

/** 새로 저장하는 모델 목록 검사. 하나라도 틀렸거나 id 가 겹치면 null. */
export function parseModelList(raw: unknown): ModelEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MODELS) return null
  const out: ModelEntry[] = []
  for (const item of raw) {
    const entry = parseEntry(item)
    if (!entry || out.some((e) => e.id === entry.id)) return null
    out.push(entry)
  }
  return out
}

/** 저장되어 있던 값을 읽는다. 깨졌으면 기본 목록. */
export function normalizeModelList(raw: unknown): ModelEntry[] {
  return parseModelList(raw) ?? DEFAULT_MODELS.map((m) => ({ ...m }))
}

/** 지시하기에서 고른 모델 id. 빈 문자열은 아직 고르지 않음. */
export function parseSelectedModel(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 60 ? raw : null
}

export function parseProvider(value: unknown): Parsed<LlmProvider> {
  return isProvider(value) ? good(value) : bad('provider')
}

export function parseApiKey(value: unknown): Parsed<string> {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_API_KEY ? good(value.trim()) : bad('key')
}

export interface SendInput {
  conversationId: string | null
  modelId: string
  text: string
}

export function parseSendInput(value: unknown, isId: (v: unknown) => boolean): Parsed<SendInput> {
  if (!isPlainObject(value)) return bad('input')
  const { conversationId, modelId, text } = value
  if (!Object.keys(value).every((k) => k === 'conversationId' || k === 'modelId' || k === 'text')) return bad('input')
  if (conversationId !== null && !isId(conversationId)) return bad('conversationId')
  if (typeof modelId !== 'string' || modelId === '' || modelId.length > 60) return bad('modelId')
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_COMMAND_TEXT) return bad('text')
  return good({ conversationId: conversationId as string | null, modelId, text })
}

export function parseDecisions(value: unknown): Parsed<{ callId: string; approve: boolean }[]> {
  if (!Array.isArray(value) || value.length > 50) return bad('decisions')
  const out: { callId: string; approve: boolean }[] = []
  for (const d of value) {
    if (!isPlainObject(d) || typeof d['callId'] !== 'string' || d['callId'].length > 200 || typeof d['approve'] !== 'boolean') return bad('decisions')
    out.push({ callId: d['callId'], approve: d['approve'] })
  }
  return good(out)
}

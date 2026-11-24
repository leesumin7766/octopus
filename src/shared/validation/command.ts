import { DEFAULT_MODELS, type CommandErrorKind, type CommandEvent, type LlmProvider, type ModelEntry } from '../command/types'
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

/** Arm id 목록(연결돼 있는 Arm, 자동 수락 Arm). id 는 소문자·숫자·하이픈. */
export function parseArmIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null
  if (!raw.every((id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id))) return null
  return [...new Set(raw as string[])]
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

const ERROR_KINDS: readonly unknown[] = ['no_key', 'auth', 'rate_limit', 'network', 'overloaded', 'bad_request', 'refusal', 'too_long', 'step_limit', 'unknown']

/** 중지할 대화: 대화 id, 또는 null(모두) */
export function parseCancelTarget(value: unknown, isId: (v: unknown) => boolean): Parsed<string | null> {
  if (value === null) return good(null)
  return typeof value === 'string' && isId(value) ? good(value) : bad('conversationId')
}

/**
 * main 이 밀어 준 진행 이벤트의 모양을 확인한다(preload 가 화면에 넘기기 전에). 모양이 틀리면 null.
 * 글 조각은 글자일 뿐이고, 화면은 그것을 HTML 로 해석하지 않는다.
 */
export function parseCommandEvent(value: unknown): CommandEvent | null {
  if (!isPlainObject(value)) return null
  const { conversationId, kind } = value
  if (typeof conversationId !== 'string' || conversationId === '' || conversationId.length > 100) return null
  switch (kind) {
    case 'text':
      return typeof value['text'] === 'string' && value['text'].length <= 100_000 ? { conversationId, kind, text: value['text'] } : null
    case 'replace':
      return value['reason'] === 'refusal' ? { conversationId, kind, reason: 'refusal' } : null
    case 'tool':
      return typeof value['name'] === 'string' && value['name'].length <= 200 ? { conversationId, kind, name: value['name'] } : null
    case 'approval':
      return { conversationId, kind }
    case 'done':
      return { conversationId, kind, ...(value['canceled'] === true ? { canceled: true } : {}) }
    case 'error':
      return ERROR_KINDS.includes(value['error']) ? { conversationId, kind, error: value['error'] as CommandErrorKind } : null
    default:
      return null
  }
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

import { MAX_LABEL_LENGTH, MAX_PATH_LENGTH, MAX_URL_LENGTH } from '../shortcuts/types'
import { FieldValidationError, type ValidationIssue } from './issues'

export class ShortcutValidationError extends FieldValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('shortcut', issues)
    this.name = 'ShortcutValidationError'
  }
}

const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:']

/**
 * 바로가기로 열 링크 검사. http·https 만 받는다(javascript:, file:, data: 등은 거부).
 * 통과하면 정리된 주소(href)를 돌려주고, 아니면 null.
 */
export function parseShortcutUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '' || text.length > MAX_URL_LENGTH) return null

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return null
  if (url.hostname === '') return null
  // 주소에 사용자 이름·비밀번호가 들어 있으면 받지 않는다(다른 사이트로 보이게 속이는 데 쓰인다).
  if (url.username !== '' || url.password !== '') return null
  return url.href
}

/** 이름: 앞뒤 공백을 뺀 뒤 비어 있지 않고 100자 이하. 통과하면 정리된 이름, 아니면 null. */
export function parseShortcutLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text !== '' && text.length <= MAX_LABEL_LENGTH ? text : null
}

/** main 이 대화상자에서 받은 경로의 기본 검사(비어 있지 않고, 길이 상한, NUL 문자 없음). */
export function isPlausiblePath(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '' && raw.length <= MAX_PATH_LENGTH && !raw.includes('\u0000')
}

// 로그에 비밀값이 섞이지 않게 가린다. 순수 함수.

export const REDACTED = '[가림]'

/** 이 이름이 들어간 필드의 값은 통째로 가린다. */
const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|credential|api[-_]?key|private[-_]?key|(^|[-_])key$|^code$/i

/** 글자 안에서 비밀로 보이는 모양들 */
const PATTERNS: readonly RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, // Authorization 헤더 값
  /\bsk-[A-Za-z0-9_-]{8,}/g, // API 키 모양
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}(\.[A-Za-z0-9_-]*)?/g, // JWT
  /([?&](?:access_token|refresh_token|id_token|token|key|api_key|apikey|secret|password|code|client_secret)=)[^&\s"']+/gi // 주소의 비밀 쿼리
]

/** 길이가 길고 글자·숫자가 섞인 덩어리(토큰일 가능성이 큰 것) */
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g

export function redactString(text: string, knownSecrets: readonly string[] = []): string {
  let out = text
  for (const secret of knownSecrets) if (secret.length >= 4) out = out.split(secret).join(REDACTED)
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (...m) => (typeof m[1] === 'string' && m[1].endsWith('=') ? `${m[1]}${REDACTED}` : REDACTED))
  }
  return out.replace(LONG_TOKEN, REDACTED)
}

/** 로그 데이터에서 비밀을 가린 JSON 친화 값을 만든다. 깊이·길이를 제한한다. */
export function redactValue(value: unknown, knownSecrets: readonly string[] = [], depth = 0): unknown {
  if (typeof value === 'string') return redactString(value, knownSecrets)
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value
  if (depth >= 5) return '[깊음]'
  if (value instanceof Error) return { name: value.name, message: redactString(value.message, knownSecrets) }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, knownSecrets, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(v, knownSecrets, depth + 1)
    }
    return out
  }
  return String(typeof value)
}

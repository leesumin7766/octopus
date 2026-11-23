import { ArmHttpError, type ArmHttp, type HttpRequestOptions, type HttpResponse } from './types'

/** 실제 fetch 와 같은 모양 중 쓰는 부분. 테스트에서는 가짜를 넣는다. */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null; forEach?(cb: (value: string, key: string) => void): void }
  text(): Promise<string>
}>

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_RETRIES = 2
const BASE_DELAY_MS = 500

export interface HttpDeps {
  fetch: HttpFetch
  /** 재시도 사이의 대기. 테스트에서는 바로 끝나는 함수를 넣는다. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const retryable = (status: number): boolean => status === 429 || status >= 500

/**
 * Arm 이 쓰는 HTTP. 시도마다 시간 제한(기본 15초), 429·5xx·네트워크 오류·시간 초과는 지수 간격(0.5초, 1초)으로 2번까지 다시 시도,
 * 응답 본문은 크기 상한(기본 5 MiB). 상태 코드는 던지지 않고 돌려준다(호출한 Arm 이 판단).
 * 던지는 오류(ArmHttpError)에는 주소·헤더·본문을 넣지 않는다.
 */
export function createHttp(deps: HttpDeps): ArmHttp {
  const sleep = deps.sleep ?? defaultSleep

  async function attempt(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await Promise.race([
        deps.fetch(url, { method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body, signal: controller.signal }),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      ])

      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) throw new ArmHttpError('too_large')
      // 본문 읽기도 같은 시간 제한 안에서.
      const text = await Promise.race([
        response.text(),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      ])
      if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ArmHttpError('too_large')

      const headers: Record<string, string> = {}
      response.headers.forEach?.((value, key) => void (headers[key.toLowerCase()] = value))
      return {
        status: response.status,
        ok: response.ok,
        headers,
        text,
        json() {
          try {
            return JSON.parse(text) as unknown
          } catch {
            throw new ArmHttpError('bad_json')
          }
        }
      }
    } catch (error) {
      if (error instanceof ArmHttpError) throw error
      throw new ArmHttpError(timedOut ? 'timeout' : 'network')
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async request(url, options = {}) {
      const retries = options.retries ?? DEFAULT_RETRIES
      let lastError: ArmHttpError | null = null
      for (let i = 0; i <= retries; i++) {
        if (i > 0) await sleep(BASE_DELAY_MS * 2 ** (i - 1))
        try {
          const response = await attempt(url, options)
          if (retryable(response.status) && i < retries) continue
          return response
        } catch (error) {
          if (!(error instanceof ArmHttpError)) throw error
          // 응답이 너무 크거나 JSON 이 아닌 것은 다시 해도 같으므로 바로 알린다.
          if (error.kind === 'too_large' || error.kind === 'bad_json') throw error
          lastError = error
        }
      }
      throw lastError ?? new ArmHttpError('network')
    }
  }
}

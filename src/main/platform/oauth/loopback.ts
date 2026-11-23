import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// 데스크톱 OAuth 의 루프백 수신기: 127.0.0.1 의 임의 빈 포트에 일회용 HTTP 서버를 열고,
// 브라우저가 돌려보낸 redirect 한 번에서 code 를 받은 뒤 곧바로 닫는다.

export type OAuthErrorKind = 'denied' | 'timeout' | 'cancelled' | 'browser' | 'no_token' | 'exchange' | 'network' | 'invalid_grant' | 'bad_response'

/** OAuth 흐름의 실패. 메시지에는 code·token·주소를 넣지 않는다. */
export class OAuthError extends Error {
  readonly kind: OAuthErrorKind
  constructor(kind: OAuthErrorKind) {
    super(`oauth ${kind}`)
    this.name = 'OAuthError'
    this.kind = kind
  }
}

export const LOOPBACK_HOST = '127.0.0.1'
export const DEFAULT_REDIRECT_PATH = '/oauth/callback'
export const DEFAULT_LOOPBACK_TIMEOUT_MS = 5 * 60_000
const LISTEN_ATTEMPTS = 12

export interface LoopbackOptions {
  /** 이 요청에 묶인 state. 다르면 그 요청은 무시한다. */
  state: string
  path?: string
  timeoutMs?: number
  /** 취소 신호 */
  signal?: AbortSignal
}

export interface LoopbackSession {
  /** 인증 주소에 넣을 redirect_uri */
  redirectUri: string
  port: number
  /** code 를 받으면 resolve, 거부·시간 초과·취소면 OAuthError 로 reject. 어느 쪽이든 서버는 이미 닫혀 있다. */
  result: Promise<{ code: string }>
  cancel(): void
}

export type StartLoopback = (options: LoopbackOptions) => Promise<LoopbackSession>

// 브라우저에 보이는 페이지. 외부 리소스를 쓰지 않는다(CSP 로도 막는다).
const PAGE = (title: string, body: string): string =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Octopus</title><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<style>body{font-family:system-ui,sans-serif;background:#f6f6f3;color:#1b1b19;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}` +
  `main{background:#fff;border:1px solid #e4e3de;border-radius:12px;padding:32px;max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#4a4945;line-height:1.6}</style></head>` +
  `<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`

const SUCCESS = PAGE('Octopus 로 돌아가세요', '로그인이 끝났어요. 이 창은 닫아도 돼요.')
const DENIED = PAGE('연결하지 않았어요', '로그인이 취소됐어요. Octopus 로 돌아가 다시 시도할 수 있어요.')
const REJECTED = PAGE('잘못된 요청이에요', 'Octopus 에서 시작한 로그인이 아니에요. 이 창은 닫아 주세요.')

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
    connection: 'close'
  })
  res.end(html)
}

export const startLoopback: StartLoopback = (options) =>
  new Promise((resolveStart, rejectStart) => {
    const path = options.path ?? DEFAULT_REDIRECT_PATH
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOOPBACK_TIMEOUT_MS
    let settle: (value: { code: string } | OAuthError) => void = () => {}
    const result = new Promise<{ code: string }>((resolve, reject) => {
      settle = (value) => (value instanceof OAuthError ? reject(value) : resolve(value))
    })
    // 아무도 기다리지 않을 때(이미 닫힌 뒤) 거부가 처리되지 않은 거부로 새지 않게 한다.
    result.catch(() => undefined)

    let finished = false
    let server: Server
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (value: { code: string } | OAuthError): void => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      // 응답이 나간 뒤 닫히도록 한 틱 미룬다. 연결은 남기지 않는다.
      server.close()
      server.closeAllConnections?.()
      settle(value)
    }
    const onAbort = (): void => finish(new OAuthError('cancelled'))

    const handle = (req: IncomingMessage, res: ServerResponse): void => {
      const port = (server.address() as AddressInfo | null)?.port
      // 127.0.0.1 로 온 요청만(DNS 리바인딩 등으로 다른 이름이 붙은 요청은 받지 않는다).
      if (req.headers.host !== `${LOOPBACK_HOST}:${port}`) return void send(res, 400, REJECTED)
      if (req.method !== 'GET') return void send(res, 405, REJECTED)

      const url = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}:${port}`)
      if (url.pathname !== path) return void send(res, 404, REJECTED) // 다른 경로는 무시하고 계속 기다린다.
      if (url.searchParams.get('state') !== options.state) return void send(res, 400, REJECTED) // state 가 다르면 무시하고 계속 기다린다.

      if (url.searchParams.get('error') !== null) {
        send(res, 200, DENIED)
        return finish(new OAuthError('denied'))
      }
      const code = url.searchParams.get('code')
      if (!code) return void send(res, 400, REJECTED)

      send(res, 200, SUCCESS)
      finish({ code })
    }

    // 일부 Windows 환경에서 listen 이 간헐적으로 EFAULT 등으로 실패한다. 서버를 새로 만들어 몇 번 다시 시도한 뒤에야 실패로 알린다.
    let attempts = 0
    const listen = (): void => {
      const candidate = createServer(handle)
      server = candidate
      candidate.once('error', () => {
        candidate.close()
        if (++attempts >= LISTEN_ATTEMPTS) return rejectStart(new OAuthError('browser'))
        setTimeout(listen, 40)
      })
      candidate.once('listening', () => {
        candidate.on('error', () => undefined) // 시작한 뒤의 소켓 오류는 흐름을 바꾸지 않는다.
        const { port } = candidate.address() as AddressInfo
        timer = setTimeout(() => finish(new OAuthError('timeout')), timeoutMs)
        if (options.signal) {
          if (options.signal.aborted) onAbort()
          else options.signal.addEventListener('abort', onAbort, { once: true })
        }
        resolveStart({ redirectUri: `http://${LOOPBACK_HOST}:${port}${path}`, port, result, cancel: onAbort })
      })
      candidate.listen(0, LOOPBACK_HOST)
    }
    listen()
  })

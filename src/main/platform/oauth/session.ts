import type { ArmHttp, ArmLog, ArmSecrets } from '../../arms/sdk/types'
import { OAuthError, startLoopback as realStartLoopback, type StartLoopback } from './loopback'
import { challengeFor, createState, createVerifier } from './pkce'
import { buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken, type OAuthClient, type OAuthProvider, type TokenSet } from './tokens'

/** 만료 이 시간(ms) 전부터는 새 토큰을 받아서 쓴다. */
export const REFRESH_MARGIN_MS = 60_000
const TOKEN_SECRET = 'oauth.tokens'

export interface OAuthSessionDeps {
  provider: OAuthProvider
  /** 호출 때마다 읽는다(고급 설정으로 클라이언트 ID 가 바뀔 수 있다). 없으면 연결할 수 없다. */
  client: () => OAuthClient | null
  /** Arm 의 비밀 이름공간. 토큰은 여기에만 저장한다. */
  secrets: ArmSecrets
  http: ArmHttp
  log: ArmLog
  /** 시스템 브라우저로 주소를 연다(주입) */
  openExternal: (url: string) => Promise<void>
  now?: () => number
  startLoopback?: StartLoopback
  timeoutMs?: number
}

export interface OAuthSession {
  /** 브라우저 로그인(루프백+PKCE)을 끝까지 진행하고 토큰을 저장한다. */
  authorize(signal?: AbortSignal): Promise<void>
  hasTokens(): boolean
  /** 쓸 수 있는 access_token. 만료 60초 전이면 먼저 새로 받는다. */
  getAccessToken(): Promise<string>
  /** 만료와 상관없이 새로 받는다(401 을 받았을 때). 실패하면 OAuthError. */
  forceRefresh(): Promise<string>
  /** 토큰 폐기를 요청하고(실패해도 계속) 저장된 토큰을 지운다. 폐기 성공 여부를 돌려준다. */
  revoke(): Promise<boolean>
}

function readTokens(secrets: ArmSecrets): TokenSet | null {
  const raw = secrets.get(TOKEN_SECRET)
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as Partial<TokenSet>
    if (typeof t.accessToken !== 'string' || typeof t.expiresAt !== 'number') return null
    return { accessToken: t.accessToken, expiresAt: t.expiresAt, ...(typeof t.refreshToken === 'string' ? { refreshToken: t.refreshToken } : {}) }
  } catch {
    return null
  }
}

export function createOAuthSession(deps: OAuthSessionDeps): OAuthSession {
  const now = deps.now ?? Date.now
  const start = deps.startLoopback ?? realStartLoopback
  let refreshing: Promise<TokenSet> | null = null

  const requireClient = (): OAuthClient => {
    const client = deps.client()
    if (!client) throw new OAuthError('invalid_grant')
    return client
  }

  /** 새로 고침은 한 번에 하나만(여러 호출이 겹쳐도 같은 요청을 기다린다). */
  function refresh(): Promise<TokenSet> {
    if (refreshing) return refreshing
    const current = readTokens(deps.secrets)
    if (!current?.refreshToken) return Promise.reject(new OAuthError('no_token'))
    const work = refreshAccessToken(deps.http, deps.provider, requireClient(), current.refreshToken, now()).then((tokens) => {
      deps.secrets.set(TOKEN_SECRET, JSON.stringify(tokens))
      return tokens
    })
    refreshing = work.finally(() => {
      refreshing = null
    })
    refreshing.catch(() => undefined)
    return refreshing
  }

  return {
    async authorize(signal) {
      const client = requireClient()
      const state = createState()
      const verifier = createVerifier()
      const loop = await start({ state, signal, timeoutMs: deps.timeoutMs })
      try {
        await deps.openExternal(buildAuthUrl(deps.provider, client, { redirectUri: loop.redirectUri, state, challenge: challengeFor(verifier) }))
      } catch {
        loop.cancel()
        throw new OAuthError('browser')
      }
      const { code } = await loop.result // denied / timeout / cancelled 는 OAuthError 로 던져진다.
      deps.log.info('oauth: code received, exchanging') // code 값은 남기지 않는다.
      const tokens = await exchangeCode(deps.http, deps.provider, client, { code, verifier, redirectUri: loop.redirectUri }, now())
      deps.secrets.set(TOKEN_SECRET, JSON.stringify(tokens))
    },

    hasTokens: () => readTokens(deps.secrets) !== null,

    async getAccessToken() {
      const tokens = readTokens(deps.secrets)
      if (!tokens) throw new OAuthError('no_token')
      if (tokens.expiresAt - now() > REFRESH_MARGIN_MS) return tokens.accessToken
      return (await refresh()).accessToken
    },

    async forceRefresh() {
      return (await refresh()).accessToken
    },

    async revoke() {
      const tokens = readTokens(deps.secrets)
      let revoked = false
      const token = tokens?.refreshToken ?? tokens?.accessToken
      if (token) revoked = await revokeToken(deps.http, deps.provider, token)
      deps.secrets.delete(TOKEN_SECRET)
      return revoked
    }
  }
}

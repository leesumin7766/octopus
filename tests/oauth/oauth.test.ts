import { describe, expect, it, vi } from 'vitest'
import { createArmContext, type LogEntry } from '../../src/main/arms/sdk/context'
import { createHttp, type HttpFetch } from '../../src/main/arms/sdk/http'
import { ArmHttpError, type ArmHttp } from '../../src/main/arms/sdk/types'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import { OAuthError, type StartLoopback } from '../../src/main/platform/oauth/loopback'
import { challengeFor, createState, createVerifier } from '../../src/main/platform/oauth/pkce'
import { createOAuthSession, REFRESH_MARGIN_MS } from '../../src/main/platform/oauth/session'
import { buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken, type OAuthProvider } from '../../src/main/platform/oauth/tokens'

const PROVIDER: OAuthProvider = {
  authUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  revokeUrl: 'https://auth.example.com/revoke',
  scopes: ['scope.a', 'scope.b'],
  extraAuthParams: { access_type: 'offline' }
}
const CLIENT = { clientId: 'client-123', clientSecret: 'client-secret-456' }

describe('PKCE', () => {
  it('verifier is 43–128 chars of unreserved characters, and different every time', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const v = createVerifier()
      expect(v.length).toBeGreaterThanOrEqual(43)
      expect(v.length).toBeLessThanOrEqual(128)
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/)
      seen.add(v)
    }
    expect(seen.size).toBe(50)
  })

  it('challenge = base64url(sha256(verifier)) — the RFC 7636 appendix B example', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    const c = challengeFor(createVerifier())
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/) // 패딩(=) 없는 base64url
  })

  it('state is random and long enough', () => {
    const a = createState()
    expect(a).not.toBe(createState())
    expect(a.length).toBeGreaterThanOrEqual(32)
  })
})

describe('auth url', () => {
  it('has client, redirect, scopes (space separated), state, S256 challenge, and the provider extras', () => {
    const url = new URL(buildAuthUrl(PROVIDER, CLIENT, { redirectUri: 'http://127.0.0.1:5000/oauth/callback', state: 'st', challenge: 'ch' }))
    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-123',
      redirect_uri: 'http://127.0.0.1:5000/oauth/callback',
      response_type: 'code',
      scope: 'scope.a scope.b',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline'
    })
    expect(url.search).not.toContain('client-secret') // 시크릿은 인증 주소에 넣지 않는다
  })
})

type Handler = (url: string, body: URLSearchParams, init: Parameters<HttpFetch>[1]) => { status: number; body?: unknown } | Error

/** 가짜 토큰 서버. 진짜 네트워크는 쓰지 않는다. */
function fakeHttp(handler: Handler): { http: ArmHttp; calls: { url: string; body: URLSearchParams }[] } {
  const calls: { url: string; body: URLSearchParams }[] = []
  const fetch: HttpFetch = async (url, init) => {
    const body = new URLSearchParams(init.body ?? '')
    calls.push({ url, body })
    const r = handler(url, body, init)
    if (r instanceof Error) throw r
    const text = JSON.stringify(r.body ?? {})
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => null }, text: async () => text }
  }
  return { http: createHttp({ fetch, sleep: async () => {} }), calls }
}

describe('token exchange / refresh / revoke', () => {
  it('exchangeCode posts code + verifier + redirect + client, and returns an expiry from expires_in', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } }))

    const tokens = await exchangeCode(http, PROVIDER, CLIENT, { code: 'CODE', verifier: 'VER', redirectUri: 'http://127.0.0.1:1/oauth/callback' }, 1_000_000)

    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1_000_000 + 3_600_000 })
    expect(calls).toHaveLength(1) // code 는 한 번만 쓸 수 있으므로 다시 시도하지 않는다
    expect(Object.fromEntries(calls[0].body)).toEqual({
      grant_type: 'authorization_code',
      code: 'CODE',
      code_verifier: 'VER',
      redirect_uri: 'http://127.0.0.1:1/oauth/callback',
      client_id: 'client-123',
      client_secret: 'client-secret-456'
    })
  })

  it('a client without a secret sends none', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: { access_token: 'AT', expires_in: 10 } }))
    await exchangeCode(http, PROVIDER, { clientId: 'c' }, { code: 'x', verifier: 'v', redirectUri: 'r' }, 0)
    expect(calls[0].body.has('client_secret')).toBe(false)
  })

  it('refresh keeps the old refresh token when the answer has none, and uses a new one when it has', async () => {
    let answer: Record<string, unknown> = { access_token: 'AT2', expires_in: 100 }
    const { http, calls } = fakeHttp(() => ({ status: 200, body: answer }))

    expect(await refreshAccessToken(http, PROVIDER, CLIENT, 'RT1', 0)).toEqual({ accessToken: 'AT2', refreshToken: 'RT1', expiresAt: 100_000 })
    answer = { access_token: 'AT3', refresh_token: 'RT2', expires_in: 100 }
    expect((await refreshAccessToken(http, PROVIDER, CLIENT, 'RT1', 0)).refreshToken).toBe('RT2')
    expect(Object.fromEntries(calls[0].body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT1', client_id: 'client-123' })
  })

  it('failures become OAuthError kinds without any token or code in the message', async () => {
    const dead = fakeHttp(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired SECRET-RT' } }))
    const e1 = (await refreshAccessToken(dead.http, PROVIDER, CLIENT, 'SECRET-RT', 0).catch((e: unknown) => e)) as OAuthError
    expect(e1).toBeInstanceOf(OAuthError)
    expect(e1.kind).toBe('invalid_grant')
    expect(e1.message).not.toContain('SECRET')

    const other = fakeHttp(() => ({ status: 401, body: { error: 'invalid_client' } }))
    expect(((await exchangeCode(other.http, PROVIDER, CLIENT, { code: 'c', verifier: 'v', redirectUri: 'r' }, 0).catch((e: unknown) => e)) as OAuthError).kind).toBe('exchange')

    const down = fakeHttp(() => new Error('ECONNRESET'))
    expect(((await refreshAccessToken(down.http, PROVIDER, CLIENT, 'rt', 0).catch((e: unknown) => e)) as OAuthError).kind).toBe('network')

    const garbage = fakeHttp(() => ({ status: 200, body: { nothing: true } }))
    expect(((await refreshAccessToken(garbage.http, PROVIDER, CLIENT, 'rt', 0).catch((e: unknown) => e)) as OAuthError).kind).toBe('bad_response')
  })

  it('revoke posts the token and reports success; any failure is swallowed', async () => {
    const ok = fakeHttp(() => ({ status: 200 }))
    expect(await revokeToken(ok.http, PROVIDER, 'RT')).toBe(true)
    expect(ok.calls[0].url).toBe('https://auth.example.com/revoke')
    expect(ok.calls[0].body.get('token')).toBe('RT')

    expect(await revokeToken(fakeHttp(() => ({ status: 500 })).http, PROVIDER, 'RT')).toBe(false)
    expect(await revokeToken(fakeHttp(() => new Error('down')).http, PROVIDER, 'RT')).toBe(false)
    expect(await revokeToken(ok.http, { ...PROVIDER, revokeUrl: undefined }, 'RT')).toBe(false)
  })
})

describe('OAuth session', () => {
  function setup(handler: Handler, start?: StartLoopback, now = { t: 1_000_000 }) {
    const store = createMemorySecureStore()
    const logs: LogEntry[] = []
    const fake = fakeHttp(handler)
    const ctx = createArmContext({
      armId: 'x-arm',
      interactive: true,
      secureStore: store,
      http: { fetch: async () => { throw new Error('unused') } },
      logSink: (e) => void logs.push(e),
      core: { addInboxCandidate: () => ({ added: false, accepted: false }), listTasks: () => [], onTasksChanged: () => () => {} }
    })
    const opened: string[] = []
    const session = createOAuthSession({
      provider: PROVIDER,
      client: () => CLIENT,
      secrets: ctx.secrets,
      http: fake.http,
      log: ctx.log,
      openExternal: async (u) => void opened.push(u),
      now: () => now.t,
      startLoopback: start
    })
    return { session, store, logs, opened, calls: fake.calls, now }
  }

  const loopbackThatReturns = (code: string, seen: { state?: string }): StartLoopback =>
    async ({ state }) => {
      seen.state = state
      return { redirectUri: 'http://127.0.0.1:7777/oauth/callback', port: 7777, result: Promise.resolve({ code }), cancel: () => {} }
    }

  it('authorize: opens the browser with state + S256 challenge, exchanges the received code with the matching verifier, stores tokens only in the arm namespace', async () => {
    const seen: { state?: string } = {}
    const s = setup(() => ({ status: 200, body: { access_token: 'ACCESS-1', refresh_token: 'REFRESH-1', expires_in: 3600 } }), loopbackThatReturns('THE-CODE', seen))

    await s.session.authorize()

    const url = new URL(s.opened[0])
    expect(url.searchParams.get('state')).toBe(seen.state) // 수신기에 넘긴 state 와 같다
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:7777/oauth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const exchange = s.calls[0].body
    expect(exchange.get('code')).toBe('THE-CODE')
    expect(challengeFor(exchange.get('code_verifier') as string)).toBe(url.searchParams.get('code_challenge'))
    expect(s.session.hasTokens()).toBe(true)
    expect(s.store.get('arm:x-arm', 'oauth.tokens')).toContain('ACCESS-1')
    expect(await s.session.getAccessToken()).toBe('ACCESS-1')
  })

  it('the log never contains the code or any token', async () => {
    const s = setup(() => ({ status: 200, body: { access_token: 'ACCESS-1', refresh_token: 'REFRESH-1', expires_in: 3600 } }), loopbackThatReturns('THE-CODE-XYZ', {}))
    await s.session.authorize()
    await s.session.getAccessToken()
    expect(s.logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(s.logs)).not.toMatch(/THE-CODE|ACCESS-1|REFRESH-1/)
  })

  it('a token still valid for more than 60 s is used as is; within 60 s it is refreshed first', async () => {
    const s = setup(() => ({ status: 200, body: { access_token: 'ACCESS-NEW', expires_in: 3600 } }), loopbackThatReturns('c', {}))
    s.store.set('arm:x-arm', 'oauth.tokens', JSON.stringify({ accessToken: 'ACCESS-OLD', refreshToken: 'RT', expiresAt: s.now.t + REFRESH_MARGIN_MS + 5_000 }))

    expect(await s.session.getAccessToken()).toBe('ACCESS-OLD')
    expect(s.calls).toHaveLength(0)

    s.now.t += 10_000 // 이제 만료까지 55초
    expect(await s.session.getAccessToken()).toBe('ACCESS-NEW')
    expect(s.calls).toHaveLength(1)
    expect(JSON.parse(s.store.get('arm:x-arm', 'oauth.tokens') as string)).toMatchObject({ accessToken: 'ACCESS-NEW', refreshToken: 'RT' }) // refresh token 유지
  })

  it('concurrent callers share one refresh request', async () => {
    const s = setup(() => ({ status: 200, body: { access_token: 'N', expires_in: 3600 } }))
    s.store.set('arm:x-arm', 'oauth.tokens', JSON.stringify({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: s.now.t - 1 }))
    const results = await Promise.all([s.session.getAccessToken(), s.session.getAccessToken(), s.session.getAccessToken()])
    expect(results).toEqual(['N', 'N', 'N'])
    expect(s.calls).toHaveLength(1)
  })

  it('no stored token → no_token; a dead refresh token → invalid_grant (and nothing is silently kept as good)', async () => {
    const empty = setup(() => ({ status: 200 }))
    expect(((await empty.session.getAccessToken().catch((e: unknown) => e)) as OAuthError).kind).toBe('no_token')

    const dead = setup(() => ({ status: 400, body: { error: 'invalid_grant' } }))
    dead.store.set('arm:x-arm', 'oauth.tokens', JSON.stringify({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 }))
    expect(((await dead.session.getAccessToken().catch((e: unknown) => e)) as OAuthError).kind).toBe('invalid_grant')
  })

  it('if the browser cannot be opened the loopback is cancelled and the flow fails', async () => {
    const cancel = vi.fn()
    const start: StartLoopback = async () => ({ redirectUri: 'http://127.0.0.1:1/oauth/callback', port: 1, result: new Promise(() => {}), cancel })
    const failing = createOAuthSession({
      provider: PROVIDER,
      client: () => CLIENT,
      secrets: { get: () => undefined, set: () => {}, delete: () => {} },
      http: fakeHttp(() => ({ status: 200 })).http,
      log: { debug() {}, info() {}, warn() {}, error() {} },
      openExternal: async () => {
        throw new Error('no browser')
      },
      startLoopback: start
    })

    expect(((await failing.authorize().catch((e: unknown) => e)) as OAuthError).kind).toBe('browser')
    expect(cancel).toHaveBeenCalled()
  })

  it('denied / timeout from the loopback reach the caller as OAuthError', async () => {
    const start: StartLoopback = async () => ({ redirectUri: 'r', port: 1, result: Promise.reject(new OAuthError('denied')), cancel: () => {} })
    const s = setup(() => ({ status: 200 }), start)
    expect(((await s.session.authorize().catch((e: unknown) => e)) as OAuthError).kind).toBe('denied')
    expect(s.session.hasTokens()).toBe(false)
  })

  it('revoke asks the provider to revoke the refresh token, and removes the stored tokens even if that fails', async () => {
    const s = setup((url) => (url.endsWith('/revoke') ? { status: 500 } : { status: 200 }))
    s.store.set('arm:x-arm', 'oauth.tokens', JSON.stringify({ accessToken: 'A', refreshToken: 'RT', expiresAt: 1 }))

    expect(await s.session.revoke()).toBe(false)

    expect(s.calls[0].body.get('token')).toBe('RT')
    expect(s.session.hasTokens()).toBe(false)
    void ArmHttpError
  })
})

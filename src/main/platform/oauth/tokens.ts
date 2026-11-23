import { ArmHttpError, type ArmHttp } from '../../arms/sdk/types'
import { OAuthError } from './loopback'

// 토큰 교환·새로 고침·폐기. 공급자 정보(주소·범위)는 인자로 받아 Google 이 아닌 곳에도 쓸 수 있다.

export interface OAuthProvider {
  authUrl: string
  tokenUrl: string
  revokeUrl?: string
  scopes: readonly string[]
  /** 인증 주소에 더 붙일 값(예: Google 의 access_type=offline) */
  extraAuthParams?: Readonly<Record<string, string>>
}

export interface OAuthClient {
  clientId: string
  /** 데스크톱 클라이언트의 "secret" 은 공개 값으로 취급한다(비밀이 아님). 없으면 보내지 않는다. */
  clientSecret?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** 만료 시각(ms, epoch) */
  expiresAt: number
}

export function buildAuthUrl(provider: OAuthProvider, client: OAuthClient, p: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(provider.authUrl)
  const params: Record<string, string> = {
    client_id: client.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: provider.scopes.join(' '),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

const form = (values: Record<string, string | undefined>): string => {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) body.set(key, value)
  return body.toString()
}

async function postToken(http: ArmHttp, provider: OAuthProvider, body: string, retries: number): Promise<Record<string, unknown>> {
  let response
  try {
    response = await http.request(provider.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      retries
    })
  } catch (error) {
    throw new OAuthError(error instanceof ArmHttpError ? 'network' : 'exchange')
  }

  let data: unknown
  try {
    data = response.json()
  } catch {
    throw new OAuthError('bad_response')
  }
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  if (!response.ok) throw new OAuthError(record.error === 'invalid_grant' ? 'invalid_grant' : 'exchange')
  return record
}

function toTokenSet(data: Record<string, unknown>, now: number, previousRefresh?: string): TokenSet {
  if (typeof data.access_token !== 'string' || data.access_token === '') throw new OAuthError('bad_response')
  const seconds = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600
  const refresh = typeof data.refresh_token === 'string' && data.refresh_token !== '' ? data.refresh_token : previousRefresh
  return { accessToken: data.access_token, ...(refresh ? { refreshToken: refresh } : {}), expiresAt: now + seconds * 1000 }
}

/** 받은 code 를 토큰으로 바꾼다. code 는 한 번만 쓸 수 있으므로 다시 시도하지 않는다. */
export async function exchangeCode(
  http: ArmHttp,
  provider: OAuthProvider,
  client: OAuthClient,
  p: { code: string; verifier: string; redirectUri: string },
  now: number
): Promise<TokenSet> {
  const data = await postToken(
    http,
    provider,
    form({ grant_type: 'authorization_code', code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri, client_id: client.clientId, client_secret: client.clientSecret }),
    0
  )
  return toTokenSet(data, now)
}

/** refresh_token 으로 새 access_token 을 받는다. 응답에 새 refresh_token 이 없으면 기존 것을 유지한다. */
export async function refreshAccessToken(http: ArmHttp, provider: OAuthProvider, client: OAuthClient, refreshToken: string, now: number): Promise<TokenSet> {
  const data = await postToken(
    http,
    provider,
    form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }),
    2
  )
  return toTokenSet(data, now, refreshToken)
}

/** 토큰 폐기 요청. 실패해도 던지지 않는다(연결 끊기는 계속 진행). 성공 여부만 돌려준다. */
export async function revokeToken(http: ArmHttp, provider: OAuthProvider, token: string): Promise<boolean> {
  if (!provider.revokeUrl) return false
  try {
    const response = await http.request(provider.revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ token }),
      retries: 0,
      timeoutMs: 8000
    })
    return response.ok
  } catch {
    return false
  }
}

import type { ArmManifest } from '../../../shared/arms/types'
import type { CalendarEvent } from '../../../shared/calendar/types'
import type { CommandTool } from '../../core/command/tools/registry'
import { OAuthError, type StartLoopback } from '../../platform/oauth/loopback'
import { createOAuthSession, type OAuthSession } from '../../platform/oauth/session'
import type { OAuthClient, OAuthProvider } from '../../platform/oauth/tokens'
import { ArmError, ArmHttpError, type Arm, type ArmContext, type ArmSecrets } from '../sdk/types'
import { describeEvent, parseEvents, todayRange } from './calendar'

export const GOOGLE_CALENDAR_ID = 'google-calendar'
/** 읽기 전용 범위 하나만. 쓰기 범위는 쓰지 않는다. */
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export const GOOGLE_PROVIDER: OAuthProvider = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: [READONLY_SCOPE],
  extraAuthParams: { access_type: 'offline', prompt: 'consent' }
}

export const MANIFEST: ArmManifest = {
  id: GOOGLE_CALENDAR_ID,
  name: 'Google 캘린더',
  version: '0.1.0',
  auth: 'oauth',
  capabilities: ['events.read', 'links', 'home.card', 'command.tools'],
  scopes: [READONLY_SCOPE],
  description: '오늘 일정을 홈에서 보고, 지시하기에서 물어볼 수 있어요. 일정은 읽기만 하고 바꾸지 않아요.'
}

export const MESSAGES = {
  notConfigured: 'Google 캘린더 연결은 아직 준비 중이에요.',
  relogin: '다시 로그인이 필요해요. [다시 연결]을 눌러 주세요.',
  expired: '로그인이 만료됐어요. [다시 연결]을 눌러 주세요.',
  denied: '로그인을 취소했어요. 다시 연결하려면 [연결]을 눌러 주세요.',
  timeout: '로그인 시간이 지났어요. [연결]을 눌러 다시 시도해 주세요.',
  cancelled: '로그인을 취소했어요.',
  browser: '브라우저를 열지 못했어요. 기본 브라우저를 확인하고 다시 시도해 주세요.',
  network: '인터넷에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  failed: 'Google 캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  notSynced: '아직 일정을 가져오지 못했어요.'
} as const

const API = 'https://www.googleapis.com/calendar/v3'
const CLIENT_ID_SECRET = 'client.id'
const CLIENT_SECRET_SECRET = 'client.secret'
const MAX_EVENTS = 50

export interface GoogleCalendarDeps {
  /** 빌드 때 주입한 공용 클라이언트(없으면 빈 값). 저장소·테스트에는 실제 값을 두지 않는다. */
  clientId?: string
  clientSecret?: string
  /** 이 Arm 의 비밀 이름공간(고급: 내 클라이언트 ID 를 저장하는 곳) */
  secrets: ArmSecrets
  /** 시스템 브라우저로 주소 열기 */
  openExternal: (url: string) => Promise<void>
  now?: () => Date
  startLoopback?: StartLoopback
  loginTimeoutMs?: number
}

export interface GoogleCalendarArm extends Arm {
  /** 마지막으로 가져온 오늘 일정(메모리 캐시). 연결돼 있지 않으면 빈 목록. */
  todayEvents(): CalendarEvent[]
}

function mapOAuthError(error: unknown): ArmError {
  if (error instanceof ArmError) return error
  if (error instanceof OAuthError) {
    const text: Record<string, string> = {
      denied: MESSAGES.denied,
      timeout: MESSAGES.timeout,
      cancelled: MESSAGES.cancelled,
      browser: MESSAGES.browser,
      network: MESSAGES.network,
      no_token: MESSAGES.relogin,
      invalid_grant: MESSAGES.relogin
    }
    return new ArmError(text[error.kind] ?? MESSAGES.failed)
  }
  if (error instanceof ArmHttpError) return new ArmError(MESSAGES.network)
  return new ArmError(MESSAGES.failed)
}

/** Google 캘린더 Arm: 오늘 일정 읽기 전용. */
export function createGoogleCalendarArm(deps: GoogleCalendarDeps): GoogleCalendarArm {
  const now = deps.now ?? (() => new Date())
  let ctx: ArmContext | null = null
  let session: OAuthSession | null = null
  let events: CalendarEvent[] = []
  let synced = false
  let expired = false

  /** 고급 설정의 내 클라이언트가 있으면 그것, 없으면 빌드에 주입된 공용 클라이언트 */
  function resolveClient(): OAuthClient | null {
    try {
      const id = deps.secrets.get(CLIENT_ID_SECRET)
      if (id) return { clientId: id, clientSecret: deps.secrets.get(CLIENT_SECRET_SECRET) || undefined }
    } catch {
      // 보안 저장소를 못 읽으면 빌드 설정만 쓴다.
    }
    return deps.clientId ? { clientId: deps.clientId, clientSecret: deps.clientSecret || undefined } : null
  }

  function sessionFor(c: ArmContext): OAuthSession {
    session = createOAuthSession({
      provider: GOOGLE_PROVIDER,
      client: resolveClient,
      secrets: c.secrets,
      http: c.http,
      log: c.log,
      openExternal: deps.openExternal,
      now: () => now().getTime(),
      startLoopback: deps.startLoopback,
      timeoutMs: deps.loginTimeoutMs
    })
    return session
  }

  /** 인증이 붙은 GET. 401 이면 새로 고침 후 한 번 더, 그래도 안 되면 로그인 만료로 본다. */
  async function authedGet(url: string): Promise<unknown> {
    if (!ctx || !session) throw new ArmError(MESSAGES.relogin)
    const http = ctx.http
    const call = async (token: string) => http.request(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })

    let response
    try {
      response = await call(await session.getAccessToken())
      if (response.status === 401) response = await call(await session.forceRefresh())
    } catch (error) {
      if (error instanceof OAuthError && (error.kind === 'invalid_grant' || error.kind === 'no_token')) {
        expired = true
        throw new ArmError(MESSAGES.expired)
      }
      throw mapOAuthError(error)
    }
    if (response.status === 401 || response.status === 403) {
      expired = true
      throw new ArmError(MESSAGES.expired)
    }
    if (!response.ok) throw new ArmError(MESSAGES.failed)
    try {
      return response.json()
    } catch {
      throw new ArmError(MESSAGES.failed)
    }
  }

  async function loadToday(): Promise<void> {
    const { timeMin, timeMax } = todayRange(now())
    const query = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax,
      maxResults: String(MAX_EVENTS),
      fields: 'items(id,summary,status,htmlLink,start,end)'
    })
    const body = await authedGet(`${API}/calendars/primary/events?${query.toString()}`)
    events = parseEvents(body)
    synced = true
    expired = false
  }

  const listTodayEvents: CommandTool<null> = {
    name: 'list_today_events',
    description: '오늘의 Google 캘린더 일정을 시간 순으로 본다(종일 일정 먼저). 사용자가 오늘 일정·약속·회의를 물을 때 쓴다.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    readOnly: true,
    parse: () => ({ ok: true, value: null }),
    run: () => (!synced ? MESSAGES.notSynced : events.length === 0 ? '오늘 일정 없음' : events.map(describeEvent).join('\n'))
  }

  return {
    manifest: MANIFEST,

    availability() {
      return resolveClient() ? { available: true } : { available: false, reason: MESSAGES.notConfigured }
    },

    advanced: {
      clientIdSaved() {
        try {
          return !!deps.secrets.get(CLIENT_ID_SECRET)
        } catch {
          return false
        }
      },
      setClient(value) {
        if (value === null) {
          deps.secrets.delete(CLIENT_ID_SECRET)
          deps.secrets.delete(CLIENT_SECRET_SECRET)
          return
        }
        deps.secrets.set(CLIENT_ID_SECRET, value.clientId)
        if (value.clientSecret) deps.secrets.set(CLIENT_SECRET_SECRET, value.clientSecret)
        else deps.secrets.delete(CLIENT_SECRET_SECRET)
      }
    },

    async connect(context) {
      ctx = context
      const oauth = sessionFor(context)
      if (!resolveClient()) throw new ArmError(MESSAGES.notConfigured)
      expired = false
      try {
        let ready = false
        if (oauth.hasTokens()) {
          try {
            await oauth.getAccessToken() // 필요하면 여기서 새로 고침한다.
            ready = true
          } catch (error) {
            if (error instanceof OAuthError && error.kind === 'network') throw error
            // 저장된 로그인이 더는 쓸 수 없다.
          }
        }
        let signedIn = false
        if (!ready) {
          if (!context.interactive) throw new ArmError(MESSAGES.relogin) // 앱을 켤 때는 로그인 창을 띄우지 않는다.
          await oauth.authorize()
          signedIn = true
        }
        try {
          await authedGet(`${API}/calendars/primary?fields=id`) // 기본 캘린더를 한 번 확인한다.
        } catch (error) {
          // 저장된 로그인이 서버에서 이미 취소된 경우: 사용자가 눌러서 연결하는 중이면 새로 로그인한다.
          if (!(expired && context.interactive && !signedIn)) throw error
          expired = false
          await oauth.authorize()
          await authedGet(`${API}/calendars/primary?fields=id`)
        }
      } catch (error) {
        throw mapOAuthError(error)
      }
      context.log.info('google calendar connected')
    },

    async disconnect() {
      events = []
      synced = false
      expired = false
      try {
        await session?.revoke() // 폐기 요청이 실패해도 계속한다(토큰은 어떻게든 지워진다).
      } catch {
        // 무시
      }
    },

    status: () => (expired ? { state: 'error', reason: MESSAGES.expired } : { state: 'on' }),

    async sync() {
      try {
        await loadToday()
      } catch (error) {
        throw mapOAuthError(error)
      }
      return { added: 0 } // 일정은 후보·할 일로 만들지 않는다.
    },

    tools: () => [listTodayEvents as CommandTool],
    todayEvents: () => [...events]
  }
}

import type { UpdateErrorKind, UpdateState } from '../../shared/update/types'

// 자동 업데이트(GitHub Releases, electron-updater). ATDT 와 같은 흐름:
// 패키지된 앱은 켠 뒤 잠시 기다렸다 한 번 확인한다 → 새 버전이 있으면 알리기만 한다 →
// 받기·다시 시작해 설치는 사용자가 누를 때만. 실패는 상태와 한 줄 로그로만 알리고 앱 동작에는 영향이 없다.

/** 켠 뒤 자동 확인까지 기다리는 시간(창이 먼저 뜨게) */
export const STARTUP_CHECK_DELAY_MS = 5000

/** electron-updater 가 쓰는 로거 모양 */
export interface UpdaterLogger {
  info(message?: unknown): void
  warn(message?: unknown): void
  error(message?: unknown): void
  debug?(message: string): void
}

interface UpdateInfoLike {
  version: string
  releaseNotes?: unknown
}

/** electron-updater 의 autoUpdater 중 쓰는 부분(시험에서는 가짜를 넣는다) */
export interface AutoUpdaterLike {
  logger: UpdaterLogger | null
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-available' | 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateChecker {
  /** 패키지된 앱에서만, 잠시 뒤 한 번 자동 확인을 걸어 둔다. 아니면 아무것도 하지 않는다. */
  start(): void
  state(): UpdateState
  /** 지금 확인한다. 받는 중·받은 뒤에는 그대로 둔다. 절대 던지지 않는다. */
  check(opts?: { auto?: boolean }): Promise<UpdateState>
  /** 새 버전이 있을 때만 받는다. 절대 던지지 않는다. */
  download(): Promise<UpdateState>
  /** 받은 새 버전이 있을 때만 다시 시작해 설치한다. true 면 설치를 시작했다. */
  install(): boolean
}

export interface UpdateCheckerDeps {
  isPackaged: boolean
  /** 설치된 버전(app.getVersion()) */
  currentVersion: string
  autoUpdater: () => AutoUpdaterLike
  log: (message: string) => void
  /** 상태가 바뀔 때마다(창에 밀어 준다) */
  onChange?: (state: UpdateState) => void
  /** 시험에서 바꾼다 */
  setTimer?: (run: () => void, ms: number) => unknown
}

/** 어떤 값이든 스택 없이 첫 줄만, 200자까지 */
export function oneLine(value: unknown): string {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value)
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const line = first.replace(/^Error:\s*(Error:\s*)?/, '').trim()
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

/** 실패를 화면이 고를 문구 종류로 나눈다(문구 자체는 화면의 ko.ts 에 있다) */
export function errorKind(value: unknown): UpdateErrorKind {
  const message = value instanceof Error ? value.message : String(value)
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|net::/i.test(message)) return 'offline'
  if (/\b404\b|latest(-mac)?\.yml|No published versions/i.test(message)) return 'noRelease'
  return 'other'
}

/** GitHub 릴리스 노트는 HTML 로 온다. 화면에는 글자만 */
export function notesText(notes: unknown): string | undefined {
  const strip = (s: string): string =>
    s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 2000)
  let text = ''
  if (typeof notes === 'string') text = strip(notes)
  else if (Array.isArray(notes)) text = notes.map((n) => (typeof n?.note === 'string' ? strip(n.note) : '')).filter(Boolean).join('\n\n').slice(0, 2000)
  return text === '' ? undefined : text
}

export function createUpdateChecker(deps: UpdateCheckerDeps): UpdateChecker {
  let state: UpdateState = deps.isPackaged ? { status: 'idle', current: deps.currentVersion } : { status: 'disabled', current: deps.currentVersion }
  let started = false
  let updater: AutoUpdaterLike | null = null
  // 같은 실패가 여러 경로(예외·error 이벤트)로 올라와도 한 줄만 남긴다.
  let lastLogged = ''
  const logOnce = (message: string): void => {
    if (message === lastLogged) return
    lastLogged = message
    deps.log(message)
  }

  /** 상태가 바뀌면 이전 상태의 부가 정보(진행률·오류)는 버린다. 설치 버전·새 버전·노트·자동 확인 여부는 유지 */
  const set = (patch: Partial<UpdateState>): void => {
    const { status, current, version, notes, auto } = state
    const next: UpdateState = { status, current, ...(version ? { version } : {}), ...(notes ? { notes } : {}), ...(auto ? { auto } : {}), ...patch }
    for (const key of Object.keys(next) as (keyof UpdateState)[]) if (next[key] === undefined) delete next[key]
    state = next
    deps.onChange?.({ ...state })
  }

  const fail = (error: unknown): void => {
    logOnce(`update failed: ${oneLine(error)}`)
    set({ status: 'error', error: errorKind(error) })
  }

  /** 처음 쓸 때 한 번 만들고 이벤트를 단다. 만들지 못하면 null(상태는 error). */
  const ensure = (): AutoUpdaterLike | null => {
    if (updater) return updater
    try {
      const u = deps.autoUpdater()
      // electron-updater 기본 로거는 실패마다 스택 전체를 stderr 에 찍는다. 조용한 로거로 바꾸고 실패는 우리가 한 줄로 남긴다.
      u.logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
      u.autoDownload = false // 받기는 사용자가 [받기]를 누를 때만
      u.autoInstallOnAppQuit = false // 설치는 사용자가 [다시 시작해서 설치]를 누를 때만(앱을 끌 때 몰래 설치하지 않는다)
      u.on('checking-for-update', () => set({ status: 'checking' }))
      u.on('update-not-available', () => set({ status: 'latest', version: undefined, notes: undefined }))
      u.on('update-available', (info) => set({ status: 'available', version: info.version, notes: notesText(info.releaseNotes) }))
      u.on('download-progress', (p) => set({ status: 'downloading', percent: Math.min(100, Math.max(0, Math.round(p.percent))) }))
      u.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
      u.on('error', fail)
      updater = u
      return u
    } catch (error) {
      fail(error)
      return null
    }
  }

  const checker: UpdateChecker = {
    start() {
      if (!deps.isPackaged || started) return
      started = true
      const schedule = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms))
      schedule(() => void checker.check({ auto: true }), STARTUP_CHECK_DELAY_MS)
    },

    state: () => ({ ...state }),

    async check(opts = {}) {
      if (!deps.isPackaged) return checker.state()
      if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return checker.state()
      const u = ensure()
      if (!u) return checker.state()
      set({ status: 'checking', auto: opts.auto === true ? true : undefined })
      try {
        await u.checkForUpdates()
      } catch (error) {
        fail(error)
      }
      return checker.state()
    },

    async download() {
      if (!updater || state.status !== 'available') return checker.state()
      set({ status: 'downloading', percent: 0 })
      try {
        await updater.downloadUpdate()
      } catch (error) {
        fail(error)
      }
      return checker.state()
    },

    install() {
      if (state.status !== 'ready' || !updater) return false
      updater.quitAndInstall(true, true) // 설치 화면 없이 설치하고 다시 켠다
      return true
    }
  }
  return checker
}

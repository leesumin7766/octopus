import type { UpdateState } from '../../shared/update/types'

// 자동 업데이트(GitHub Releases, electron-updater). 확인은 패키지된 앱에서 시작할 때 한 번만 하고,
// 실패는 조용히 로그만 남기며, 내려받은 뒤의 설치·재시작은 사용자가 승인해야만 한다.

/** electron-updater 의 autoUpdater 중 쓰는 부분(시험에서는 가짜를 넣는다) */
/** electron-updater 가 쓰는 로거 모양 */
export interface UpdaterLogger {
  info(message?: unknown): void
  warn(message?: unknown): void
  error(message?: unknown): void
  debug?(message: string): void
}

export interface AutoUpdaterLike {
  logger: UpdaterLogger | null
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdateChecker {
  /** 패키지된 앱에서만 한 번 확인한다. 아니면 아무것도 하지 않는다. 절대 던지지 않는다. */
  start(): Promise<void>
  state(): UpdateState
  /** 내려받은 새 버전이 있을 때만 다시 시작해 설치한다. true 면 설치를 시작했다. */
  install(): boolean
}

/** 어떤 값이든 스택 없이 첫 줄만, 200자까지 */
export function oneLine(value: unknown): string {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value)
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const line = first.replace(/^Error:\s*(Error:\s*)?/, '').trim()
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

export function createUpdateChecker(deps: { isPackaged: boolean; autoUpdater: () => AutoUpdaterLike; log: (message: string) => void }): UpdateChecker {
  let state: UpdateState = { status: 'none' }
  let started = false
  let updater: AutoUpdaterLike | null = null
  // 같은 실패가 여러 경로(예외·error 이벤트)로 올라와도 한 줄만 남긴다.
  let lastLogged = ''
  const logOnce = (message: string): void => {
    if (message === lastLogged) return
    lastLogged = message
    deps.log(message)
  }

  return {
    async start() {
      if (!deps.isPackaged || started) return
      started = true
      try {
        updater = deps.autoUpdater()
        // electron-updater 기본 로거는 실패마다 스택 전체를 stderr 에 찍는다. 우리 한 줄 로거로 바꾼다(정보·경고는 버리고, 실패는 아래에서 한 줄로).
        updater.logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
        updater.autoDownload = true // 내려받기만 한다
        updater.autoInstallOnAppQuit = false // 설치는 사용자가 누를 때만(앱을 끌 때 몰래 설치하지 않는다)
        updater.on('update-available', (info) => void (state = { status: 'downloading', version: info.version }))
        updater.on('update-downloaded', (info) => void (state = { status: 'ready', version: info.version }))
        updater.on('error', (error) => logOnce(`update check failed: ${oneLine(error)}`))
        await updater.checkForUpdates()
      } catch (error) {
        // 오프라인·릴리스 없음 등: 앱 동작에는 영향이 없다.
        logOnce(`update check failed: ${oneLine(error)}`)
      }
    },

    state: () => ({ ...state }),

    install() {
      if (state.status !== 'ready' || !updater) return false
      updater.quitAndInstall()
      return true
    }
  }
}

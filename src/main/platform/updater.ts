import type { UpdateState } from '../../shared/update/types'

// 자동 업데이트(GitHub Releases, electron-updater). 확인은 패키지된 앱에서 시작할 때 한 번만 하고,
// 실패는 조용히 로그만 남기며, 내려받은 뒤의 설치·재시작은 사용자가 승인해야만 한다.

/** electron-updater 의 autoUpdater 중 쓰는 부분(시험에서는 가짜를 넣는다) */
export interface AutoUpdaterLike {
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

export function createUpdateChecker(deps: { isPackaged: boolean; autoUpdater: () => AutoUpdaterLike; log: (message: string) => void }): UpdateChecker {
  let state: UpdateState = { status: 'none' }
  let started = false
  let updater: AutoUpdaterLike | null = null

  return {
    async start() {
      if (!deps.isPackaged || started) return
      started = true
      try {
        updater = deps.autoUpdater()
        updater.autoDownload = true // 내려받기만 한다
        updater.autoInstallOnAppQuit = false // 설치는 사용자가 누를 때만(앱을 끌 때 몰래 설치하지 않는다)
        updater.on('update-available', (info) => void (state = { status: 'downloading', version: info.version }))
        updater.on('update-downloaded', (info) => void (state = { status: 'ready', version: info.version }))
        updater.on('error', (error) => deps.log(`update error: ${error.message}`))
        await updater.checkForUpdates()
      } catch (error) {
        // 오프라인·릴리스 없음 등: 앱 동작에는 영향이 없다.
        deps.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`)
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

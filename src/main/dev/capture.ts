import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { App, BrowserWindow } from 'electron'
import { readCaptureConfig, type CaptureConfig } from './captureSupport'

// 개발용 화면 캡처. OCTOPUS_CAPTURE 환경 변수가 있을 때만, 배포된 앱이 아닐 때만 동작한다.

export interface CaptureSession {
  config: CaptureConfig
  /** 실제 사용자 DB 를 건드리지 않도록 userData 를 옮겨 둔 임시 폴더 */
  userDataDir: string
}

const SETTLE_MS = 1500
const STREAMING_SETTLE_MS = 4000
const GIVE_UP_MS = 30_000

/** app ready 전에 불러야 한다. 캡처 모드가 아니면 null. */
export function prepareCapture(app: Pick<App, 'isPackaged' | 'setPath'>, env: NodeJS.ProcessEnv = process.env): CaptureSession | null {
  const config = readCaptureConfig(env, app.isPackaged)
  if (!config) return null

  const userDataDir = mkdtempSync(join(tmpdir(), 'octopus-capture-'))
  app.setPath('userData', userDataDir)
  return { config, userDataDir }
}

/** 창이 뜨고 잠시 기다린 뒤 화면을 PNG 로 저장하고 앱을 끝낸다. 실패하면 종료 코드 1. */
export function captureWhenLoaded(win: BrowserWindow, session: CaptureSession, app: Pick<App, 'quit' | 'exit' | 'isPackaged'>): void {
  if (app.isPackaged) return

  const giveUp = setTimeout(() => {
    console.error('[octopus] capture timed out')
    app.exit(1)
  }, GIVE_UP_MS)

  // 스트리밍 중간 화면은 자동으로 보낸 말의 첫 조각들이 쌓일 시간이 더 필요하다.
  const settleMs = session.config.view === 'command-streaming' ? STREAMING_SETTLE_MS : SETTLE_MS
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void win.webContents
        .capturePage()
        .then((image) => {
          const { outputPath } = session.config
          mkdirSync(dirname(outputPath), { recursive: true })
          writeFileSync(outputPath, image.toPNG())
          console.log(`[octopus] capture saved: ${outputPath}`)
          clearTimeout(giveUp)
          app.quit()
        })
        .catch((error: unknown) => {
          console.error('[octopus] capture failed', error)
          app.exit(1)
        })
    }, settleMs)
  })
}

/** 임시 userData 를 지운다. 아직 잠겨 있는 파일이 있으면 그대로 둔다. */
export function cleanupCapture(session: CaptureSession | null): void {
  if (!session) return
  try {
    rmSync(session.userDataDir, { recursive: true, force: true })
  } catch {
    // 임시 폴더라서 못 지워도 문제 없다.
  }
}

import type { BrowserWindow, Dialog, Shell } from 'electron'
import type { PathType } from '../../shared/shortcuts/types'
import { parseShortcutUrl } from '../../shared/validation/shortcut'

/** 바로가기를 여는 데 필요한, 운영체제와 닿는 동작들. 핸들러는 이 모양만 안다(테스트에서는 가짜를 넣는다). */
export interface ShortcutPlatform {
  /** 링크를 기본 브라우저로 연다. */
  openExternal(url: string): Promise<void>
  /** 파일·폴더를 기본 프로그램으로 연다. 성공하면 빈 문자열, 실패하면 오류 글. */
  openPath(path: string): Promise<string>
  pathExists(path: string): boolean
  /** 파일(또는 폴더) 선택 대화상자. 고른 경로, 취소하면 null. */
  pickPath(kind: PathType): Promise<string | null>
  /** 실행 파일을 처음 열 때 확인 창. 허용하면 true. */
  confirmRunExecutable(info: { label: string; path: string }): Promise<boolean>
}

export interface ShortcutPlatformDeps {
  shell: Pick<Shell, 'openExternal' | 'openPath'>
  dialog: Pick<Dialog, 'showOpenDialog' | 'showMessageBox'>
  /** 대화상자를 붙일 창(없으면 창 없이 연다) */
  getWindow: () => BrowserWindow | null
  pathExists: (path: string) => boolean
}

// 운영체제 기본 대화상자에 보이는 글. (앱 화면 문구가 아니라 main 에서 직접 띄우는 창이다.)
const TEXT = {
  pickFile: '파일 고르기',
  pickFolder: '폴더 고르기',
  confirmTitle: '프로그램 실행 확인',
  confirmMessage: (label: string) => `"${label}" 은(는) 프로그램이나 스크립트라서 열면 바로 실행돼요. 실행할까요?`,
  open: '열기',
  cancel: '취소'
} as const

export function createShortcutPlatform(deps: ShortcutPlatformDeps): ShortcutPlatform {
  return {
    async openExternal(url) {
      // 한 번 더 막는다: 어떤 경로로 들어왔든 http·https 가 아니면 열지 않는다.
      if (parseShortcutUrl(url) === null) throw new Error('refusing to open a non-http(s) address')
      await deps.shell.openExternal(url)
    },

    openPath: (path) => deps.shell.openPath(path),

    pathExists: deps.pathExists,

    async pickPath(kind) {
      const window = deps.getWindow()
      const options = {
        title: kind === 'folder' ? TEXT.pickFolder : TEXT.pickFile,
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile'] as ('openDirectory' | 'openFile')[]
      }
      const result = window ? await deps.dialog.showOpenDialog(window, options) : await deps.dialog.showOpenDialog(options)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },

    async confirmRunExecutable({ label, path }) {
      const window = deps.getWindow()
      const options = {
        type: 'warning' as const,
        title: TEXT.confirmTitle,
        message: TEXT.confirmMessage(label),
        detail: path,
        buttons: [TEXT.open, TEXT.cancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      }
      const result = window ? await deps.dialog.showMessageBox(window, options) : await deps.dialog.showMessageBox(options)
      return result.response === 0
    }
  }
}

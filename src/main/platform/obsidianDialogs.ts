import type { BrowserWindow, Dialog } from 'electron'

// 옵시디언 Arm 이 main 에서 직접 띄우는 대화상자 둘. (앱 화면 문구가 아니라 운영체제 대화상자에 보이는 글이다.)

const TEXT = {
  pickTitle: '옵시디언 볼트 폴더 고르기',
  pickButton: '이 폴더 쓰기',
  gitTitle: '.gitignore 수정 확인',
  gitMessage: '.gitignore 에 아래 한 줄을 추가할까요?',
  gitExplain: '옵시디언이 계속 바꾸는 작업 영역 파일(.obsidian/workspace.json 등)이 git 변경 목록에 끼어드는 것을 막아요. 다른 줄은 바꾸지 않아요.',
  add: '추가',
  cancel: '취소'
} as const

export interface DialogDeps {
  dialog: Pick<Dialog, 'showOpenDialog' | 'showMessageBox'>
  getWindow: () => BrowserWindow | null
}

/** 폴더 선택 대화상자. 고른 폴더 경로, 취소하면 null. 렌더러는 경로를 보내지 못하고 이 창으로만 정해진다. */
export function createFolderPicker(deps: DialogDeps): () => Promise<string | null> {
  return async () => {
    const options = { title: TEXT.pickTitle, buttonLabel: TEXT.pickButton, properties: ['openDirectory' as const] }
    const window = deps.getWindow()
    const result = window ? await deps.dialog.showOpenDialog(window, options) : await deps.dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }
}

/** .gitignore 에 줄을 더하기 전 확인 창: 파일 경로와 추가할 줄을 그대로 보여 주고, 기본 선택은 취소. [추가]를 눌렀을 때만 true. */
export function createGitignoreConfirm(deps: DialogDeps): (info: { path: string; line: string }) => Promise<boolean> {
  return async (info) => {
    const options = {
      type: 'question' as const,
      title: TEXT.gitTitle,
      message: TEXT.gitMessage,
      detail: `${info.path}\n\n${info.line}\n\n${TEXT.gitExplain}`,
      buttons: [TEXT.cancel, TEXT.add],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const window = deps.getWindow()
    const result = window ? await deps.dialog.showMessageBox(window, options) : await deps.dialog.showMessageBox(options)
    return result.response === 1
  }
}

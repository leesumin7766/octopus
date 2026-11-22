/** 바로가기: 자주 여는 링크(URL)·파일·폴더·앱. 경로는 main 의 파일 선택 대화상자로만 정한다. */

export type ShortcutKind = 'url' | 'path'
export type PathType = 'file' | 'folder'

export interface Shortcut {
  id: string
  kind: ShortcutKind
  /** kind 가 path 일 때만: 파일인지 폴더인지(아이콘용) */
  pathType: PathType | null
  label: string
  /** URL 이거나 경로. 화면에 보여 주기만 하고, 열 때는 id 로만 요청한다. */
  target: string
  /** 실행 파일 바로가기를 사용자가 한 번 허용했는지 */
  allowed: boolean
  order: number
  createdAt: string
  updatedAt: string
}

/** 링크 하나를 새로 추가할 때 보내는 값 */
export interface AddUrlInput {
  url: string
  /** 비우면 주소의 호스트 이름 */
  label?: string
}

export type MoveDirection = 'up' | 'down'

/** shortcuts:open 의 결과. 실행 파일 확인 창에서 취소하면 opened=false(오류 아님). */
export interface OpenResult {
  opened: boolean
}

export const MAX_LABEL_LENGTH = 100
export const MAX_URL_LENGTH = 2048
export const MAX_PATH_LENGTH = 4096

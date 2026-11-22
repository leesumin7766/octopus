import type { IpcResult } from '../ipc'
import type { AddUrlInput, MoveDirection, OpenResult, PathType, Shortcut } from './types'

/**
 * preload 가 window.octopus.shortcuts 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다.
 * 렌더러가 경로나 주소를 "열어 달라"고 보내는 채널은 없다. 열기는 id 로만, 경로 추가는 파일 선택 대화상자로만 한다.
 */
export interface ShortcutsApi {
  list(): Promise<IpcResult<Shortcut[]>>
  addUrl(input: AddUrlInput): Promise<IpcResult<Shortcut>>
  /** main 이 파일(또는 폴더) 선택 대화상자를 열고, 고른 것을 바로가기로 저장한다. 취소하면 null. */
  pickPath(kind: PathType): Promise<IpcResult<Shortcut | null>>
  /** id 로만 연다. 실행 파일은 처음 열 때 main 이 확인 창을 띄우고, 취소하면 opened=false. */
  open(id: string): Promise<IpcResult<OpenResult>>
  rename(id: string, label: string): Promise<IpcResult<Shortcut>>
  remove(id: string): Promise<IpcResult<null>>
  move(id: string, direction: MoveDirection): Promise<IpcResult<null>>
}

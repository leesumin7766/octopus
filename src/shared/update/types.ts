import type { IpcResult } from '../ipc'

/**
 * 업데이트 상태. 패키지된(설치된) 앱에서만 시작할 때 한 번 확인한다.
 * none: 새 버전 없음/확인 안 함 · downloading: 새 버전을 내려받는 중 · ready: 내려받았고 사용자가 [다시 시작해서 설치] 를 누르기를 기다림
 */
export interface UpdateState {
  status: 'none' | 'downloading' | 'ready'
  version?: string
}

export interface UpdateApi {
  state(): Promise<IpcResult<UpdateState>>
  /** ready 일 때만 앱을 다시 시작해 설치한다(사용자가 누른 경우에만). 그 밖에는 아무 일도 하지 않는다. */
  install(): Promise<IpcResult<null>>
}

import type { IpcResult } from '../ipc'
import type { Task } from '../tasks/types'
import type { ArmInfo, InboxCandidate } from './types'

/** preload 가 window.octopus.arms 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다. */
export interface ArmsApi {
  list(): Promise<IpcResult<ArmInfo[]>>
  /** 연결이 끝날 때까지(로그인 창 등 포함) 기다렸다가 결과 상태를 돌려준다. Arm 쪽 실패는 오류가 아니라 status 'error' 로 온다. */
  connect(id: string): Promise<IpcResult<ArmInfo>>
  /** 저장된 로그인 정보를 지우고 끊는다. 할 일은 그대로 남는다. */
  disconnect(id: string): Promise<IpcResult<ArmInfo>>
  setAutoAccept(id: string, on: boolean): Promise<IpcResult<ArmInfo>>
}

/** 수신함 후보. 후보를 받아들이면 수신함 할 일이 된다. */
export interface CandidatesApi {
  /** 아직 처리하지 않은 후보 */
  list(): Promise<IpcResult<InboxCandidate[]>>
  accept(id: string): Promise<IpcResult<Task>>
  dismiss(id: string): Promise<IpcResult<null>>
  /** 처리한 개수 */
  acceptAll(): Promise<IpcResult<number>>
  dismissAll(): Promise<IpcResult<number>>
  /** 원본 링크를 기본 브라우저로 연다. 주소는 id 로 찾은 저장값만 쓰고, http/https 가 아니면 열지 않는다. */
  openSource(id: string): Promise<IpcResult<null>>
}

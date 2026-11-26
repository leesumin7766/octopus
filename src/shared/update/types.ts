import type { IpcResult } from '../ipc'

/**
 * 업데이트 진행 상태(ATDT 와 같은 흐름). 패키지된(설치된) 앱만 확인한다.
 * disabled: 개발 모드(확인하지 않음) · idle: 아직 확인 전 · checking: 확인 중 · latest: 최신
 * available: 새 버전이 있음(받기는 사용자가 누를 때만) · downloading: 받는 중 · ready: 받았고 [다시 시작해서 설치]를 기다림 · error: 실패
 */
export const UPDATE_STATUSES = ['disabled', 'idle', 'checking', 'latest', 'available', 'downloading', 'ready', 'error'] as const
export type UpdateStatus = (typeof UPDATE_STATUSES)[number]

/** offline: 서버에 닿지 못함 · noRelease: 배포된 업데이트 정보가 없음 · other: 그 밖 */
export const UPDATE_ERRORS = ['offline', 'noRelease', 'other'] as const
export type UpdateErrorKind = (typeof UPDATE_ERRORS)[number]

export interface UpdateState {
  status: UpdateStatus
  /** 설치된 버전 */
  current: string
  /** 새 버전 */
  version?: string
  /** 릴리스 노트(글자만) */
  notes?: string
  /** 받는 중 진행률 0~100 */
  percent?: number
  error?: UpdateErrorKind
  /** 앱을 켤 때 한 자동 확인이면 true */
  auto?: boolean
}

export interface UpdateApi {
  state(): Promise<IpcResult<UpdateState>>
  /** 지금 확인한다(설정의 [업데이트 확인]) */
  check(): Promise<IpcResult<UpdateState>>
  /** available 일 때만 새 버전을 받는다(사용자가 누른 경우에만) */
  download(): Promise<IpcResult<UpdateState>>
  /** ready 일 때만 앱을 다시 시작해 설치한다(사용자가 누른 경우에만). 그 밖에는 아무 일도 하지 않는다. */
  install(): Promise<IpcResult<null>>
  /** 상태가 바뀔 때마다 받는다. 돌려준 함수로 해제한다. */
  onState(listener: (state: UpdateState) => void): () => void
}

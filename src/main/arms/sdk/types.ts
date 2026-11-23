import type { ArmManifest, ArmStatus, CandidateInput } from '../../../shared/arms/types'
import type { Task, TaskView } from '../../../shared/tasks/types'
import type { CommandTool } from '../../core/command/tools/registry'

// Arm SDK 의 공개 타입. 계약: docs/contracts/arm.md

/** sync 한 번의 결과 */
export interface ArmSyncResult {
  /** 이번에 새로 수신함 후보로 넣은 개수(참고용) */
  added?: number
}

/**
 * Arm 이 일부러 던지는 오류. message 는 사용자에게 그대로 보이므로
 * "무엇이 안 됐고 다음에 무엇을 하면 되는지"를 한국어 한두 문장으로 쓴다. 비밀값·주소·원문 오류를 넣지 않는다.
 * 이 클래스가 아닌 예외는 관리자가 일반 문구로 바꿔 보여 준다.
 */
export class ArmError extends Error {
  constructor(userMessage: string) {
    super(userMessage)
    this.name = 'ArmError'
  }
}

/** Arm 별 비밀 저장소. 이름공간은 'arm:<id>' 로 고정되어 다른 Arm 의 값은 보이지 않는다. */
export interface ArmSecrets {
  get(name: string): string | undefined
  set(name: string, value: string): void
  delete(name: string): void
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  /** 한 번 시도의 시간 제한(ms). 기본 15000 */
  timeoutMs?: number
  /** 응답 본문 크기 상한(바이트). 기본 5 MiB */
  maxBytes?: number
  /** 429·5xx·네트워크 오류 때 다시 시도하는 횟수. 기본 2 */
  retries?: number
}

export interface HttpResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
  /** 본문을 JSON 으로 읽는다. 틀리면 ArmHttpError('bad_json') */
  json(): unknown
}

export type ArmHttpErrorKind = 'timeout' | 'network' | 'too_large' | 'bad_json'

/** http 가 던지는 오류. 메시지에 주소·헤더·본문을 넣지 않는다. */
export class ArmHttpError extends Error {
  readonly kind: ArmHttpErrorKind
  constructor(kind: ArmHttpErrorKind) {
    super(`http ${kind}`)
    this.name = 'ArmHttpError'
    this.kind = kind
  }
}

export interface ArmHttp {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>
}

export interface ArmLog {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface AddCandidateResult {
  /** 새로 들어갔는지(이미 있거나 무시된 후보면 false) */
  added: boolean
  /** 자동 수락 설정으로 곧바로 수신함 할 일이 됐는지 */
  accepted: boolean
}

/** 코어가 Arm 에 열어 주는 공개 서비스. 읽기와 후보 추가뿐이다. */
export interface ArmCoreServices {
  /** 후보를 수신함 후보 목록에 넣는다. 출처 Arm 은 항상 이 Arm 으로 기록된다. */
  addInboxCandidate(candidate: CandidateInput): AddCandidateResult
  /** 할 일 읽기(today 는 지난 것 포함). 쓰기는 없다. */
  listTasks(view: TaskView): Task[]
}

/** Arm 이 쓸 수 있는 전부. 이것 밖의 것(DB·파일·전역 fetch)을 직접 쓰지 않는다. */
export interface ArmContext {
  armId: string
  /** 사용자가 [연결]을 눌러 시작했으면 true. 앱 시작 때 자동 재연결이면 false — 로그인 창 같은 화면을 띄우면 안 된다. */
  interactive: boolean
  secrets: ArmSecrets
  http: ArmHttp
  log: ArmLog
  core: ArmCoreServices
}

export interface Arm {
  manifest: ArmManifest
  /**
   * 로그인·폴더 선택 등. 이미 저장된 정보로 다시 연결할 수 있어야 하고(여러 번 불려도 안전),
   * interactive 가 false 인데 사용자 조작이 필요하면 ArmError 로 알린다. 실패는 예외로 알린다(관리자가 잡는다).
   */
  connect(ctx: ArmContext): Promise<void>
  /** 연결 끊기 전 정리. 비밀 이름공간은 끝난 뒤 관리자가 통째로 지우므로 여기서 지울 필요는 없다. */
  disconnect(): Promise<void>
  /** Arm 이 아는 현재 상태. 토큰 만료를 알아챘으면 {state:'error', reason} 로 알려 준다. */
  status(): ArmStatus
  /** 주기 실행. 가능하면 예외를 던지지 않고 ArmSyncResult 로 끝낸다(던져도 관리자가 잡는다). */
  sync?(): Promise<ArmSyncResult>
  /** 지시하기에 줄 도구. 연결된 동안만 쓰이고, 끊기면 도구도 사라진다. */
  tools?(): CommandTool[]
}

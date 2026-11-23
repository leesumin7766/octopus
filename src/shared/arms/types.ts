// Arm(바깥 도구 연결 단위)의 main·renderer 공용 타입. 계약: docs/contracts/arm.md

export const ARM_AUTH_KINDS = ['none', 'oauth', 'apiKey', 'folder', 'mcp'] as const
export type ArmAuth = (typeof ARM_AUTH_KINDS)[number]

export const ARM_CAPABILITIES = [
  'tasks.import', // 할 일 후보를 수신함으로 보냄
  'tasks.export', // 할 일을 바깥으로 내보냄
  'events.read', // 일정 읽기
  'events.write', // 일정 쓰기 (승인 필요)
  'links', // 원본 열기 링크
  'notify', // 알림
  'command.tools', // 지시하기에 도구 제공
  'home.card' // 홈 카드 제공
] as const
export type ArmCapability = (typeof ARM_CAPABILITIES)[number]

export interface ArmManifest {
  /** 'google-calendar' 처럼 소문자·숫자·하이픈 */
  id: string
  /** 화면 이름 */
  name: string
  version: string
  auth: ArmAuth
  capabilities: ArmCapability[]
  /** OAuth 범위(최소로) */
  scopes?: string[]
  /** 카드에 보이는 한두 문장 설명 */
  description?: string
  /** sync 주기(분). 생략하면 15분. */
  syncIntervalMinutes?: number
}

export type ArmState = 'off' | 'connecting' | 'on' | 'error'

export interface ArmStatus {
  state: ArmState
  /** state 가 'error' 일 때, 사용자가 다음에 할 일이 담긴 사람이 읽는 이유 */
  reason?: string
}

/** 화면에 보여 주는 Arm 한 개 */
export interface ArmInfo {
  id: string
  name: string
  version: string
  description: string
  auth: ArmAuth
  capabilities: ArmCapability[]
  status: ArmStatus
  /** 들어온 후보를 확인 없이 수신함에 넣는지(tasks.import 가 있는 Arm 만 의미 있음) */
  autoAccept: boolean
}

// ---- 수신함 후보 ----

export type CandidateStatus = 'pending' | 'accepted' | 'dismissed'

/** Arm 이 넘기는 후보. 제목·메모는 외부 데이터라 화면에서 HTML 로 해석하지 않는다. */
export interface CandidateInput {
  /** Arm 안에서 원본을 가리키는 고유 값. (arm, ref) 가 같으면 같은 후보다. */
  ref: string
  title: string
  notes?: string
  /** 원본 열기 링크(http/https 만) */
  url?: string
  /** 마감일 YYYY-MM-DD */
  dueDate?: string
}

export interface InboxCandidate {
  id: string
  armId: string
  ref: string
  title: string
  notes: string
  url: string | null
  dueDate: string | null
  status: CandidateStatus
  createdAt: string
}

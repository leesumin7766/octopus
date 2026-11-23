import type { IpcResult } from '../ipc'
import type { ArmStatus } from '../arms/types'

// 옵시디언 Arm(내보내기 + 선택적 적어 넣기)의 main·renderer 공용 타입. 규칙: CLAUDE.md 6.3

/** off: 쓰지 않음 · export: 내보내기만(권장) · both: 내보내기 + 적어 넣기 */
export type ObsidianMode = 'off' | 'export' | 'both'

export const DEFAULT_EXPORT_FILE = 'Octopus/할 일.md'

/** 설정(obsidian.config)에 저장되는 값 */
export interface ObsidianConfig {
  /** 고른 vault 폴더(main 의 폴더 선택 대화상자로만 정해진다). 없으면 빈 문자열 */
  vaultPath: string
  mode: ObsidianMode
  /** vault 기준 상대 경로(.md). 기본 'Octopus/할 일.md' */
  file: string
  /** 오늘 일일노트가 이미 있을 때만 맨 끝에 링크 한 줄(기본 꺼짐) */
  dailyNote: boolean
  /** 처음 연결할 때 "적어 넣기" 후보를 자동 수락으로 켜 두었는지(사용자가 끈 것을 다시 켜지 않으려고) */
  autoAcceptInitialized: boolean
}

export const DEFAULT_OBSIDIAN_CONFIG: ObsidianConfig = {
  vaultPath: '',
  mode: 'export',
  file: DEFAULT_EXPORT_FILE,
  dailyNote: false,
  autoAcceptInitialized: false
}

export interface ObsidianGitCheck {
  /** vault 가 git 저장소인지 */
  isGit: boolean
  /** 무시되지 않고 있는 파일들(보통 .obsidian/workspace.json 등) */
  notIgnored: string[]
  /** 추가하려는 .gitignore 한 줄 */
  line: string
}

/** 설정 화면이 그리는 전부. 렌더러가 경로를 보내는 일은 없다(읽기 전용 표시). */
export interface ObsidianState {
  status: ArmStatus
  /** 이 빌드에서 Arm 이 등록돼 있는지(없으면 화면을 못 쓴다) */
  available: boolean
  config: ObsidianConfig
  vaultName: string
  /** vault 안에 .obsidian 폴더가 있는지(없으면 "옵시디언 vault 가 아닌 것 같아요" 경고) */
  looksLikeVault: boolean
  lastExportAt: string | null
  lastExportError: string | null
  /** 일일노트 링크 점검: 지원하지 않는 형식이면 이유 */
  dailyProblem: string | null
  git: ObsidianGitCheck | null
  /** 지금 할 일 데이터로 만든 내보내기 내용(글자로만 보여 준다). 연결 전이면 null */
  preview: string | null
}

export interface ObsidianConfigPatch {
  mode?: ObsidianMode
  file?: string
  dailyNote?: boolean
}

export interface ObsidianApi {
  state(): Promise<IpcResult<ObsidianState>>
  setConfig(patch: ObsidianConfigPatch): Promise<IpcResult<ObsidianState>>
  /** main 이 폴더 선택 대화상자를 연다. 취소하면 그대로. */
  changeVault(): Promise<IpcResult<ObsidianState>>
  exportNow(): Promise<IpcResult<ObsidianState>>
  /** main 이 확인 창(추가할 줄을 그대로 보여 줌)을 띄우고, 허용하면 .gitignore 에 한 줄을 더한다. */
  fixGitignore(): Promise<IpcResult<ObsidianState>>
  /** obsidian://open 주소는 main 이 만든다(렌더러는 동작만 요청). */
  open(): Promise<IpcResult<null>>
}

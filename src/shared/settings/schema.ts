import { defaultLayout, normalizeLayout, parseLayout, type HomeLayout } from '../home/layout'
import type { ModelEntry } from '../command/types'
import type { McpServerConfig } from '../mcp/types'
import { DEFAULT_OBSIDIAN_CONFIG, type ObsidianConfig } from '../obsidian/types'
import { normalizeObsidianConfig, parseObsidianConfig } from '../validation/obsidian'
import { normalizeMcpServers, parseMcpApprovals, parseMcpServers, type McpApproval } from '../validation/mcp'
import { DEFAULT_MODELS } from '../command/types'
import { normalizeModelList, parseArmIds, parseModelList, parseSelectedModel } from '../validation/command'
import { DEFAULT_PIE_SLOTS, normalizePieSlots, parsePieSlots, type ActionId } from '../pie/actions'

// 앱 설정: 키마다 값의 모양을 정해 두고, 모르는 키와 틀린 값은 받지 않는다.

export interface SettingsMap {
  /** 홈 카드 배치와 경계 비율 */
  'home.layout': HomeLayout
  /** 왼쪽 메뉴를 접었는지 */
  'nav.collapsed': boolean
  /** 원형 메뉴 8칸이 실행할 액션(12시부터 시계 방향) */
  'pie.slots': ActionId[]
  /** 지시하기에서 고를 수 있는 모델 목록(키는 여기에 없다) */
  'command.models': ModelEntry[]
  /** 지시하기에서 고른 모델 id(빈 문자열이면 목록의 첫 모델) */
  'command.model': string
  /** 연결돼 있는 Arm 의 id 목록(앱을 켜면 다시 연결을 시도한다) */
  'arms.connected': string[]
  /** 들어온 후보를 확인 없이 수신함에 넣을 Arm 의 id 목록 */
  'arms.autoAccept': string[]
  /** 추가한 MCP 서버(환경 변수는 이름만) */
  'mcp.servers': McpServerConfig[]
  /** 실행을 허용한 stdio 명령의 지문(그 명령 그대로에만 유효) */
  'mcp.approvals': McpApproval[]
  /** 옵시디언 Arm 설정(vault 경로·모드·내보낼 파일·일일노트 링크) */
  'obsidian.config': ObsidianConfig
  /** 첫 실행 안내(3단계)를 끝내거나 건너뛰었는지 */
  'onboarding.done': boolean
}

export type SettingKey = keyof SettingsMap

export const SETTING_KEYS: readonly SettingKey[] = ['home.layout', 'nav.collapsed', 'pie.slots', 'command.models', 'command.model', 'arms.connected', 'arms.autoAccept', 'mcp.servers', 'mcp.approvals', 'obsidian.config', 'onboarding.done']

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value)
}

export function defaultSetting<K extends SettingKey>(key: K): SettingsMap[K] {
  const value: SettingsMap[SettingKey] =
    key === 'home.layout' ? defaultLayout() : key === 'pie.slots' ? [...DEFAULT_PIE_SLOTS] : key === 'command.models' ? DEFAULT_MODELS.map((m) => ({ ...m })) : key === 'command.model' ? '' : key === 'arms.connected' || key === 'arms.autoAccept' || key === 'mcp.servers' || key === 'mcp.approvals' ? [] : key === 'obsidian.config' ? { ...DEFAULT_OBSIDIAN_CONFIG } : key === 'nav.collapsed' ? true : false
  return value as SettingsMap[K]
}

/** 새로 저장하는 값 검사. 모양이 틀리면 null. */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingsMap[K] | null {
  const value: SettingsMap[SettingKey] | null =
    key === 'home.layout' ? parseLayout(raw) : key === 'pie.slots' ? parsePieSlots(raw) : key === 'command.models' ? parseModelList(raw) : key === 'command.model' ? parseSelectedModel(raw) : key === 'arms.connected' || key === 'arms.autoAccept' ? parseArmIds(raw) : key === 'mcp.servers' ? parseMcpServers(raw) : key === 'mcp.approvals' ? parseMcpApprovals(raw) : key === 'obsidian.config' ? parseObsidianConfig(raw) : typeof raw === 'boolean' ? raw : null
  return value as SettingsMap[K] | null
}

/** 저장되어 있던 값을 읽는다. 깨졌으면 기본값. */
export function readSetting<K extends SettingKey>(key: K, raw: unknown): SettingsMap[K] {
  const value: SettingsMap[SettingKey] =
    key === 'home.layout' ? normalizeLayout(raw) : key === 'pie.slots' ? normalizePieSlots(raw) : key === 'command.models' ? normalizeModelList(raw) : key === 'command.model' ? (parseSelectedModel(raw) ?? '') : key === 'arms.connected' || key === 'arms.autoAccept' ? (parseArmIds(raw) ?? []) : key === 'mcp.servers' ? normalizeMcpServers(raw) : key === 'mcp.approvals' ? (parseMcpApprovals(raw) ?? []) : key === 'obsidian.config' ? normalizeObsidianConfig(raw) : typeof raw === 'boolean' ? raw : false
  return value as SettingsMap[K]
}

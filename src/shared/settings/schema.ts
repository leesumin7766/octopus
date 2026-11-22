import { defaultLayout, normalizeLayout, parseLayout, type HomeLayout } from '../home/layout'
import type { ModelEntry } from '../command/types'
import { DEFAULT_MODELS } from '../command/types'
import { normalizeModelList, parseModelList } from '../validation/command'
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
}

export type SettingKey = keyof SettingsMap

export const SETTING_KEYS: readonly SettingKey[] = ['home.layout', 'nav.collapsed', 'pie.slots', 'command.models']

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value)
}

export function defaultSetting<K extends SettingKey>(key: K): SettingsMap[K] {
  const value: SettingsMap[SettingKey] =
    key === 'home.layout' ? defaultLayout() : key === 'pie.slots' ? [...DEFAULT_PIE_SLOTS] : key === 'command.models' ? DEFAULT_MODELS.map((m) => ({ ...m })) : false
  return value as SettingsMap[K]
}

/** 새로 저장하는 값 검사. 모양이 틀리면 null. */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingsMap[K] | null {
  const value: SettingsMap[SettingKey] | null =
    key === 'home.layout' ? parseLayout(raw) : key === 'pie.slots' ? parsePieSlots(raw) : key === 'command.models' ? parseModelList(raw) : typeof raw === 'boolean' ? raw : null
  return value as SettingsMap[K] | null
}

/** 저장되어 있던 값을 읽는다. 깨졌으면 기본값. */
export function readSetting<K extends SettingKey>(key: K, raw: unknown): SettingsMap[K] {
  const value: SettingsMap[SettingKey] =
    key === 'home.layout' ? normalizeLayout(raw) : key === 'pie.slots' ? normalizePieSlots(raw) : key === 'command.models' ? normalizeModelList(raw) : typeof raw === 'boolean' ? raw : false
  return value as SettingsMap[K]
}

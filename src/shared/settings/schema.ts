import { defaultLayout, normalizeLayout, parseLayout, type HomeLayout } from '../home/layout'

// 앱 설정: 키마다 값의 모양을 정해 두고, 모르는 키와 틀린 값은 받지 않는다.

export interface SettingsMap {
  /** 홈 카드 배치와 경계 비율 */
  'home.layout': HomeLayout
  /** 왼쪽 메뉴를 접었는지 */
  'nav.collapsed': boolean
}

export type SettingKey = keyof SettingsMap

export const SETTING_KEYS: readonly SettingKey[] = ['home.layout', 'nav.collapsed']

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && (SETTING_KEYS as readonly string[]).includes(value)
}

export function defaultSetting<K extends SettingKey>(key: K): SettingsMap[K] {
  const value: SettingsMap[SettingKey] = key === 'home.layout' ? defaultLayout() : false
  return value as SettingsMap[K]
}

/** 새로 저장하는 값 검사. 모양이 틀리면 null. */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingsMap[K] | null {
  const value: SettingsMap[SettingKey] | null = key === 'home.layout' ? parseLayout(raw) : typeof raw === 'boolean' ? raw : null
  return value as SettingsMap[K] | null
}

/** 저장되어 있던 값을 읽는다. 깨졌으면 기본값. */
export function readSetting<K extends SettingKey>(key: K, raw: unknown): SettingsMap[K] {
  const value: SettingsMap[SettingKey] = key === 'home.layout' ? normalizeLayout(raw) : typeof raw === 'boolean' ? raw : false
  return value as SettingsMap[K]
}

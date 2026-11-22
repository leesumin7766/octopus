import type { DatabaseSync } from 'node:sqlite'
import {
  isSettingKey,
  parseSetting,
  readSetting,
  type SettingKey,
  type SettingsMap
} from '../../../shared/settings/schema'
import { SettingsValidationError } from '../../../shared/validation/settings'

export interface SettingsRepository {
  /** 저장된 값. 저장된 적이 없거나 깨졌으면 기본값. */
  get<K extends SettingKey>(key: K): SettingsMap[K]
  /** 키와 값의 모양을 검사해 저장하고, 저장된 값을 돌려준다. 틀리면 SettingsValidationError. */
  set<K extends SettingKey>(key: K, value: unknown): SettingsMap[K]
}

// 새 테이블 없이 001 의 app_meta(key, value) 를 쓴다. 다른 용도의 키와 섞이지 않게 접두사를 붙인다.
const PREFIX = 'settings.'

export function createSettingsRepository(db: DatabaseSync): SettingsRepository {
  return {
    get(key) {
      const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(PREFIX + key) as { value: string } | undefined
      if (row === undefined) return readSetting(key, undefined)
      try {
        return readSetting(key, JSON.parse(row.value))
      } catch {
        return readSetting(key, undefined) // 저장된 글자가 깨졌으면 기본값
      }
    },

    set(key, value) {
      if (!isSettingKey(key)) throw new SettingsValidationError([{ field: 'key', message: 'is not a known setting' }])
      const parsed = parseSetting(key, value)
      if (parsed === null) throw new SettingsValidationError([{ field: 'value', message: 'has the wrong shape' }])

      db.prepare(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(PREFIX + key, JSON.stringify(parsed))
      return parsed
    }
  }
}

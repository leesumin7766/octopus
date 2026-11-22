import type { IpcResult } from '../ipc'
import type { SettingKey, SettingsMap } from './schema'

/** preload 가 window.octopus.settings 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다. */
export interface SettingsApi {
  /** 저장된 값을 돌려준다. 저장된 적이 없거나 깨졌으면 기본값. */
  get<K extends SettingKey>(key: K): Promise<IpcResult<SettingsMap[K]>>
  /** 값을 저장하고, 저장된(정리된) 값을 돌려준다. */
  set<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<IpcResult<SettingsMap[K]>>
}

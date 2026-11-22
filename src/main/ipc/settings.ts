import { IPC, type IpcResult } from '../../shared/ipc'
import { isSettingKey, parseSetting, type SettingKey, type SettingsMap } from '../../shared/settings/schema'
import type { SettingsRepository } from '../core/settings/settingsRepository'
import { dbUnavailable, invalidInput, runGuarded, type ErrorLogger, type IpcMainLike } from './result'

export interface SettingsHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getRepository: () => SettingsRepository | null
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한 뒤 결과 객체를 돌려준다. electron 을 쓰지 않는다. */
export interface SettingsHandlers {
  get(key: unknown): IpcResult<SettingsMap[SettingKey]>
  set(key: unknown, value: unknown): IpcResult<SettingsMap[SettingKey]>
}

export function createSettingsHandlers(deps: SettingsHandlerDeps): SettingsHandlers {
  return {
    get(key) {
      if (!isSettingKey(key)) return invalidInput('key')
      const repo = deps.getRepository()
      if (!repo) return dbUnavailable()
      return runGuarded(IPC.settingsGet, deps.logError, () => repo.get(key))
    },

    set(key, value) {
      if (!isSettingKey(key)) return invalidInput('key')
      if (parseSetting(key, value) === null) return invalidInput('value')
      const repo = deps.getRepository()
      if (!repo) return dbUnavailable()
      return runGuarded(IPC.settingsSet, deps.logError, () => repo.set(key, value))
    }
  }
}

/** 채널과 핸들러를 잇기만 하는 얇은 등록 함수. */
export function registerSettingsHandlers(ipc: IpcMainLike, handlers: SettingsHandlers): void {
  ipc.handle(IPC.settingsGet, (_event, key) => handlers.get(key))
  ipc.handle(IPC.settingsSet, (_event, key, value) => handlers.set(key, value))
}

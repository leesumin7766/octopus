import { IPC, type IpcResult } from '../../shared/ipc'
import type { UpdateState } from '../../shared/update/types'
import type { UpdateChecker } from '../platform/updater'
import type { IpcMainLike } from './result'

export interface UpdateHandlers {
  state(): IpcResult<UpdateState>
  install(): IpcResult<null>
}

export function createUpdateHandlers(deps: { getChecker: () => UpdateChecker | null }): UpdateHandlers {
  return {
    state: () => ({ ok: true, data: deps.getChecker()?.state() ?? { status: 'none' } }),
    install() {
      deps.getChecker()?.install() // 내려받은 새 버전이 없으면 아무 일도 하지 않는다.
      return { ok: true, data: null }
    }
  }
}

export function registerUpdateHandlers(ipc: IpcMainLike, h: UpdateHandlers): void {
  ipc.handle(IPC.updateState, () => h.state())
  ipc.handle(IPC.updateInstall, () => h.install())
}

import { IPC, type IpcResult } from '../../shared/ipc'
import type { UpdateState } from '../../shared/update/types'
import type { UpdateChecker } from '../platform/updater'
import type { IpcMainLike } from './result'

export interface UpdateHandlers {
  state(): IpcResult<UpdateState>
  check(): Promise<IpcResult<UpdateState>>
  download(): Promise<IpcResult<UpdateState>>
  install(): IpcResult<null>
}

const DISABLED: UpdateState = { status: 'disabled', current: '' }

// 어느 채널도 인자를 받지 않는다. 확인·받기는 실패해도 던지지 않고 상태(error)로 돌려준다.
export function createUpdateHandlers(deps: { getChecker: () => UpdateChecker | null }): UpdateHandlers {
  return {
    state: () => ({ ok: true, data: deps.getChecker()?.state() ?? DISABLED }),
    async check() {
      const checker = deps.getChecker()
      return { ok: true, data: checker ? await checker.check() : DISABLED }
    },
    async download() {
      const checker = deps.getChecker()
      return { ok: true, data: checker ? await checker.download() : DISABLED }
    },
    install() {
      deps.getChecker()?.install() // 받은 새 버전이 없으면 아무 일도 하지 않는다.
      return { ok: true, data: null }
    }
  }
}

export function registerUpdateHandlers(ipc: IpcMainLike, h: UpdateHandlers): void {
  ipc.handle(IPC.updateState, () => h.state())
  ipc.handle(IPC.updateCheck, () => h.check())
  ipc.handle(IPC.updateDownload, () => h.download())
  ipc.handle(IPC.updateInstall, () => h.install())
}

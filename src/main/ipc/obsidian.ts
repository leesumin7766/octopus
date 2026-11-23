import { IPC, type IpcResult } from '../../shared/ipc'
import type { ObsidianState } from '../../shared/obsidian/types'
import { parseObsidianPatch } from '../../shared/validation/obsidian'
import type { ObsidianArm } from '../arms/obsidian/arm'
import { ArmError } from '../arms/sdk/types'
import { failure, invalidInput, toFailure, type ErrorLogger, type IpcMainLike } from './result'

export interface ObsidianHandlerDeps {
  getArm: () => ObsidianArm | null
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한다. vault 경로를 받는 채널은 없다(폴더는 main 의 대화상자로만 정해진다). */
export interface ObsidianHandlers {
  state(): Promise<IpcResult<ObsidianState>>
  setConfig(patch: unknown): Promise<IpcResult<ObsidianState>>
  changeVault(): Promise<IpcResult<ObsidianState>>
  exportNow(): Promise<IpcResult<ObsidianState>>
  fixGitignore(): Promise<IpcResult<ObsidianState>>
  open(): Promise<IpcResult<null>>
}

export function createObsidianHandlers(deps: ObsidianHandlerDeps): ObsidianHandlers {
  async function with_<T>(channel: string, fn: (arm: ObsidianArm) => Promise<T>): Promise<IpcResult<T>> {
    const arm = deps.getArm()
    if (!arm) return failure({ code: 'not_found' })
    try {
      return { ok: true, data: await fn(arm) }
    } catch (error) {
      if (error instanceof ArmError) return invalidInput('file') // 사용자가 고칠 수 있는 입력 문제(경로 등)
      return toFailure(channel, error, deps.logError)
    }
  }

  return {
    state: () => with_(IPC.obsidianState, (a) => a.getState()),

    async setConfig(patch) {
      const parsed = parseObsidianPatch(patch)
      if (!parsed.ok) return invalidInput(parsed.field)
      return with_(IPC.obsidianSetConfig, (a) => a.setConfig(parsed.value))
    },

    changeVault: () => with_(IPC.obsidianChangeVault, (a) => a.changeVault()),
    exportNow: () => with_(IPC.obsidianExportNow, (a) => a.exportNow()),
    fixGitignore: () => with_(IPC.obsidianFixGitignore, (a) => a.fixGitignore()),

    async open() {
      const result = await with_(IPC.obsidianOpen, async (a) => {
        await a.openTarget()
        return null
      })
      return result
    }
  }
}

export function registerObsidianHandlers(ipc: IpcMainLike, h: ObsidianHandlers): void {
  ipc.handle(IPC.obsidianState, () => h.state())
  ipc.handle(IPC.obsidianSetConfig, (_e, patch) => h.setConfig(patch))
  ipc.handle(IPC.obsidianChangeVault, () => h.changeVault())
  ipc.handle(IPC.obsidianExportNow, () => h.exportNow())
  ipc.handle(IPC.obsidianFixGitignore, () => h.fixGitignore())
  ipc.handle(IPC.obsidianOpen, () => h.open())
}

import type { McpServerInfo } from '../../shared/mcp/types'
import { IPC, type IpcResult } from '../../shared/ipc'
import { parseMcpAddInput, parseMcpId } from '../../shared/validation/mcp'
import type { McpService } from '../arms/mcp/service'
import { dbUnavailable, failure, invalidInput, toFailure, type ErrorLogger, type IpcMainLike } from './result'

export interface McpHandlerDeps {
  /** DB 를 열지 못했으면 null */
  getService: () => McpService | null
  logError: ErrorLogger
}

/** 채널마다 받은 인자를 그대로(unknown) 받아 검사한다. 응답에는 환경 변수 값이 없다(이름만). */
export interface McpHandlers {
  list(): IpcResult<McpServerInfo[]>
  add(input: unknown): Promise<IpcResult<McpServerInfo>>
  remove(id: unknown): Promise<IpcResult<null>>
  reconnect(id: unknown): Promise<IpcResult<McpServerInfo>>
}

export function createMcpHandlers(deps: McpHandlerDeps): McpHandlers {
  return {
    list() {
      const service = deps.getService()
      if (!service) return dbUnavailable()
      try {
        return { ok: true, data: service.list() }
      } catch (error) {
        return toFailure(IPC.mcpList, error, deps.logError)
      }
    },

    async add(input) {
      const parsed = parseMcpAddInput(input)
      if (!parsed.ok) return invalidInput(parsed.field)
      const service = deps.getService()
      if (!service) return dbUnavailable()
      try {
        return { ok: true, data: await service.add(parsed.value) }
      } catch (error) {
        return toFailure(IPC.mcpAdd, error, deps.logError)
      }
    },

    async remove(id) {
      const parsed = parseMcpId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      const service = deps.getService()
      if (!service) return dbUnavailable()
      try {
        return (await service.remove(parsed.value)) ? { ok: true, data: null } : failure({ code: 'not_found' })
      } catch (error) {
        return toFailure(IPC.mcpRemove, error, deps.logError)
      }
    },

    async reconnect(id) {
      const parsed = parseMcpId(id)
      if (!parsed.ok) return invalidInput(parsed.field)
      const service = deps.getService()
      if (!service) return dbUnavailable()
      try {
        const info = await service.reconnect(parsed.value)
        return info ? { ok: true, data: info } : failure({ code: 'not_found' })
      } catch (error) {
        return toFailure(IPC.mcpReconnect, error, deps.logError)
      }
    }
  }
}

export function registerMcpHandlers(ipc: IpcMainLike, h: McpHandlers): void {
  ipc.handle(IPC.mcpList, () => h.list())
  ipc.handle(IPC.mcpAdd, (_e, input) => h.add(input))
  ipc.handle(IPC.mcpRemove, (_e, id) => h.remove(id))
  ipc.handle(IPC.mcpReconnect, (_e, id) => h.reconnect(id))
}

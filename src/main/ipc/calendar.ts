import type { CalendarToday } from '../../shared/calendar/types'
import { IPC, type IpcResult } from '../../shared/ipc'
import type { CalendarProvider } from '../arms/google-calendar/provider'
import { failure, invalidInput, runGuarded, toFailure, type ErrorLogger, type IpcMainLike } from './result'

export const GOOGLE_CALENDAR_WEB = 'https://calendar.google.com/'
const EVENT_ID = /^[\w@.-]{1,200}$/

export interface CalendarHandlerDeps {
  getProvider: () => CalendarProvider | null
  openExternal: (url: string) => Promise<void>
  logError: ErrorLogger
}

export interface CalendarHandlers {
  today(): IpcResult<CalendarToday>
  openEvent(id: unknown): Promise<IpcResult<null>>
  openWeb(): Promise<IpcResult<null>>
}

export function createCalendarHandlers(deps: CalendarHandlerDeps): CalendarHandlers {
  return {
    today() {
      const provider = deps.getProvider()
      if (!provider) return { ok: true, data: { configured: false, status: { state: 'off' }, events: [] } }
      return runGuarded(IPC.calendarToday, deps.logError, () => provider.today())
    },

    async openEvent(id) {
      if (typeof id !== 'string' || !EVENT_ID.test(id)) return invalidInput('id')
      try {
        // 열 주소는 id 로 찾은 일정의 저장값뿐이다. 렌더러가 보낸 문자열은 어디에도 쓰이지 않는다.
        const url = deps.getProvider()?.findEvent(id)?.url
        if (!url) return failure({ code: 'not_found' })
        if (new URL(url).protocol !== 'https:') return invalidInput('url') // 한 번 더 확인: https 만 연다.
        await deps.openExternal(url)
        return { ok: true, data: null }
      } catch (error) {
        return toFailure(IPC.calendarOpenEvent, error, deps.logError)
      }
    },

    async openWeb() {
      try {
        await deps.openExternal(GOOGLE_CALENDAR_WEB)
        return { ok: true, data: null }
      } catch (error) {
        return toFailure(IPC.calendarOpenWeb, error, deps.logError)
      }
    }
  }
}

export function registerCalendarHandlers(ipc: IpcMainLike, h: CalendarHandlers): void {
  ipc.handle(IPC.calendarToday, () => h.today())
  ipc.handle(IPC.calendarOpenEvent, (_e, id) => h.openEvent(id))
  ipc.handle(IPC.calendarOpenWeb, () => h.openWeb())
}

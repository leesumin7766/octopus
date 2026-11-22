import type { IpcError, IpcResult } from '../../shared/ipc'
import { FieldValidationError } from '../../shared/validation/issues'
import { EntityNotFoundError } from '../core/errors'

// 할 일·루틴·메모 핸들러가 함께 쓰는 결과 객체 만들기.

/** ipcMain 이 가진 handle 만 필요하다. electron 을 import 하지 않고 테스트할 수 있게 좁혀 둔다. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/** 예상 못 한 예외의 자세한 내용을 남기는 곳(main 로그). 응답에는 넣지 않는다. */
export type ErrorLogger = (channel: string, error: unknown) => void

export function failure(error: IpcError): IpcResult<never> {
  return { ok: false, error }
}

export function invalidInput(...fields: string[]): IpcResult<never> {
  return failure({ code: 'invalid_input', fields })
}

export function dbUnavailable(): IpcResult<never> {
  return failure({ code: 'db_unavailable' })
}

/** 저장소 예외를 결과 객체로 바꾼다. 입력값·메시지·스택은 응답에 넣지 않는다. */
export function toFailure(channel: string, error: unknown, logError: ErrorLogger): IpcResult<never> {
  if (error instanceof FieldValidationError) {
    return invalidInput(...new Set(error.issues.map((issue) => issue.field)))
  }
  if (error instanceof EntityNotFoundError) return failure({ code: 'not_found' })
  logError(channel, error)
  return failure({ code: 'internal' })
}

export function runGuarded<T>(channel: string, logError: ErrorLogger, fn: () => T): IpcResult<T> {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    return toFailure(channel, error, logError)
  }
}

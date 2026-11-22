import type { IpcError } from '../../shared/ipc'
import { ko } from '../i18n/ko'

const t = ko.tasks

/** 오류 코드별로 사용자가 다음에 할 일을 알려 주는 문구. */
export function errorMessage(error: IpcError): string {
  if (error.code === 'invalid_input') {
    if (error.fields?.includes('title')) return t.errors.emptyTitle
    if (error.fields?.includes('text')) return t.errors.textTooLong
  }
  return t.errors[error.code]
}

export type FieldErrors = Partial<Record<keyof typeof t.fieldErrors, string>>

/** invalid_input 의 fields 를 필드별 문구로 바꾼다. 모르는 필드는 general 로 모은다. */
export function fieldErrorsFrom(fields: readonly string[] | undefined): FieldErrors {
  const messages: FieldErrors = {}
  for (const field of fields ?? []) {
    const key = (field in t.fieldErrors ? field : 'general') as keyof typeof t.fieldErrors
    messages[key] = t.fieldErrors[key]
  }
  if (Object.keys(messages).length === 0) messages.general = t.fieldErrors.general
  return messages
}

import { FieldValidationError, type ValidationIssue } from './issues'

export class MemoValidationError extends FieldValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('memo', issues)
    this.name = 'MemoValidationError'
  }
}

/** 메모 본문 길이 상한(글자 수) */
export const MAX_MEMO_LENGTH = 100_000

/** 본문은 비어 있지 않아야 하고(공백만 있어도 안 됨) 상한을 넘지 않아야 한다. */
export function validateMemoBody(body: unknown): ValidationIssue[] {
  if (typeof body !== 'string' || body.trim() === '') return [{ field: 'body', message: 'must be a non-empty string' }]
  if (body.length > MAX_MEMO_LENGTH) return [{ field: 'body', message: `must be at most ${MAX_MEMO_LENGTH} characters` }]
  return []
}

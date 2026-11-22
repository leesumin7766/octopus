import { FieldValidationError, type ValidationIssue } from './issues'

export class RoutineValidationError extends FieldValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('routine', issues)
    this.name = 'RoutineValidationError'
  }
}

export const MAX_ROUTINE_TITLE_LENGTH = 200

/** 요일 목록을 중복 없이 오름차순으로. 배열이 아니면 그대로 돌려줘 검증이 잡게 한다. */
export function normalizeDays(days: unknown): unknown {
  return Array.isArray(days) ? [...new Set(days)].sort((a, b) => Number(a) - Number(b)) : days
}

/** 정리(제목 trim, 요일 정렬)가 끝난 값을 검사한다. 틀린 필드마다 이유를 하나씩 돌려준다. */
export function validateRoutineFields(
  fields: Readonly<Record<'title' | 'days' | 'active', unknown>>
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (typeof fields.title !== 'string' || fields.title.trim() === '') {
    issues.push({ field: 'title', message: 'must be a non-empty string' })
  } else if (fields.title.length > MAX_ROUTINE_TITLE_LENGTH) {
    issues.push({ field: 'title', message: `must be at most ${MAX_ROUTINE_TITLE_LENGTH} characters` })
  }

  const days = fields.days
  const daysOk =
    Array.isArray(days) && days.length > 0 && days.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
  if (!daysOk) issues.push({ field: 'days', message: 'must be a non-empty array of integers 0-6' })

  if (typeof fields.active !== 'boolean') issues.push({ field: 'active', message: 'must be a boolean' })

  return issues
}

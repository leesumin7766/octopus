import type { TaskFields } from '../tasks/types'

export interface ValidationIssue {
  field: string
  message: string
}

/** 메시지에는 입력값을 넣지 않는다. 화면 문구는 호출하는 쪽에서 field 로 고른다. */
export class TaskValidationError extends Error {
  readonly issues: readonly ValidationIssue[]

  constructor(issues: readonly ValidationIssue[]) {
    super(`invalid task: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`)
    this.name = 'TaskValidationError'
    this.issues = issues
  }
}

const BUCKETS: readonly unknown[] = ['inbox', 'scheduled', 'someday']
const FREQS: readonly unknown[] = ['daily', 'weekly', 'monthly', 'yearly']
const DATE_PATTERN = /^([1-9]\d{3})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** 실제로 존재하는 YYYY-MM-DD 인지(2026-02-30 은 거짓). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(0)
  probe.setUTCFullYear(year, month - 1, day)
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

export function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function repeatProblem(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return 'must be an object or null'
  const rule = value as Record<string, unknown>
  if (!FREQS.includes(rule['freq'])) return 'freq must be daily, weekly, monthly or yearly'
  if (!isIntInRange(rule['interval'], 1, Number.MAX_SAFE_INTEGER)) return 'interval must be a positive integer'
  const weekdays = rule['byWeekday']
  if (weekdays !== undefined && !(Array.isArray(weekdays) && weekdays.every((d) => isIntInRange(d, 0, 6)))) {
    return 'byWeekday must be an array of integers 0-6'
  }
  const monthDay = rule['byMonthDay']
  if (monthDay !== undefined && !isIntInRange(monthDay, 1, 31)) return 'byMonthDay must be an integer 1-31'
  return null
}

function sourceProblem(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return 'must be an object or null'
  const source = value as Record<string, unknown>
  if (!isNonEmptyString(source['arm'])) return 'arm must be a non-empty string'
  if (!isNonEmptyString(source['ref'])) return 'ref must be a non-empty string'
  if (source['url'] !== undefined && typeof source['url'] !== 'string') return 'url must be a string'
  return null
}

/**
 * 정리(trim 등)가 끝난 필드를 검사한다. 틀린 필드마다 이유를 하나씩 돌려주고,
 * 문제가 없으면 빈 배열이다. 입력은 바깥(IPC)에서 올 수 있어 타입을 믿지 않는다.
 */
export function validateTaskFields(fields: Readonly<Record<keyof TaskFields, unknown>>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (field: string, message: string): void => {
    issues.push({ field, message })
  }

  if (!isNonEmptyString(fields.title)) add('title', 'must be a non-empty string')
  if (typeof fields.notes !== 'string') add('notes', 'must be a string')

  const bucketOk = BUCKETS.includes(fields.bucket)
  if (!bucketOk) add('bucket', 'must be inbox, scheduled or someday')

  const dateOk = fields.date === null || isValidDateString(fields.date)
  if (!dateOk) add('date', 'must be null or an existing date in YYYY-MM-DD')
  if (!(fields.deadline === null || isValidDateString(fields.deadline))) {
    add('deadline', 'must be null or an existing date in YYYY-MM-DD')
  }
  if (!(fields.time === null || isValidTimeString(fields.time))) add('time', 'must be null or HH:mm')

  if (!isIntInRange(fields.priority, 0, 3)) add('priority', 'must be an integer 0-3')
  if (!(fields.project === null || typeof fields.project === 'string')) add('project', 'must be a string or null')
  if (!(Array.isArray(fields.tags) && fields.tags.every(isNonEmptyString))) {
    add('tags', 'must be an array of non-empty strings')
  }
  if (!(fields.routineId === null || typeof fields.routineId === 'string')) {
    add('routineId', 'must be a string or null')
  }

  const repeat = repeatProblem(fields.repeat)
  if (repeat) add('repeat', repeat)
  const source = sourceProblem(fields.source)
  if (source) add('source', source)

  // bucket 과 date 의 일관성: scheduled ⇔ date 있음
  if (bucketOk && dateOk) {
    if (fields.bucket === 'scheduled' && fields.date === null) add('date', 'is required when bucket is scheduled')
    if (fields.bucket !== 'scheduled' && fields.date !== null) {
      add('date', 'must be null when bucket is inbox or someday')
    }
  }

  return issues
}

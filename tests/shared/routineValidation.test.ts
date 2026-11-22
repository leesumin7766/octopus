import { describe, expect, it } from 'vitest'
import { FieldValidationError } from '../../src/shared/validation/issues'
import { TaskValidationError, validateTaskFields } from '../../src/shared/validation/task'
import { MAX_MEMO_LENGTH, MemoValidationError, validateMemoBody } from '../../src/shared/validation/memo'
import {
  normalizeDays,
  RoutineValidationError,
  validateRoutineFields
} from '../../src/shared/validation/routine'
import { parseTaskInput, parseTaskPatch } from '../../src/shared/validation/taskIpc'

const fields = (overrides: Record<string, unknown> = {}) => ({ title: '스트레칭', days: [1, 2], active: true, ...overrides })
const problems = (overrides: Record<string, unknown>) => validateRoutineFields(fields(overrides)).map((i) => i.field)

describe('validateRoutineFields', () => {
  it('accepts a valid routine', () => {
    expect(validateRoutineFields(fields())).toEqual([])
    expect(problems({ days: [0, 1, 2, 3, 4, 5, 6] })).toEqual([])
  })

  it('rejects each wrong field', () => {
    expect(problems({ title: '' })).toEqual(['title'])
    expect(problems({ title: '   ' })).toEqual(['title'])
    expect(problems({ title: 5 })).toEqual(['title'])
    expect(problems({ title: 'x'.repeat(201) })).toEqual(['title'])
    expect(problems({ days: [] })).toEqual(['days'])
    expect(problems({ days: [-1] })).toEqual(['days'])
    expect(problems({ days: [7] })).toEqual(['days'])
    expect(problems({ days: [1.5] })).toEqual(['days'])
    expect(problems({ days: ['1'] })).toEqual(['days'])
    expect(problems({ days: null })).toEqual(['days'])
    expect(problems({ active: 1 })).toEqual(['active'])
    expect(problems({ active: undefined })).toEqual(['active'])
  })
})

describe('normalizeDays', () => {
  it('sorts and removes duplicates, and leaves non-arrays for validation to catch', () => {
    expect(normalizeDays([5, 1, 5, 3])).toEqual([1, 3, 5])
    expect(normalizeDays('x')).toBe('x')
    expect(normalizeDays(undefined)).toBeUndefined()
  })
})

describe('validateMemoBody', () => {
  it('needs a non-blank string within the limit', () => {
    expect(validateMemoBody('메모')).toEqual([])
    expect(validateMemoBody('x'.repeat(MAX_MEMO_LENGTH))).toEqual([])
    for (const body of ['', '  \n ', 5, null, undefined, 'x'.repeat(MAX_MEMO_LENGTH + 1)]) {
      expect(validateMemoBody(body).map((i) => i.field)).toEqual(['body'])
    }
  })
})

describe('validation errors share one parent', () => {
  it('Task, Routine and Memo errors are all FieldValidationError and keep their issues', () => {
    const issue = [{ field: 'x', message: 'bad' }]
    for (const error of [new TaskValidationError(issue), new RoutineValidationError(issue), new MemoValidationError(issue)]) {
      expect(error).toBeInstanceOf(FieldValidationError)
      expect(error.issues).toEqual(issue)
    }
    expect(new TaskValidationError(issue).message).toBe('invalid task: x bad')
    expect(new RoutineValidationError(issue).message).toBe('invalid routine: x bad')
    expect(new MemoValidationError(issue).message).toBe('invalid memo: x bad')
  })
})

describe('tasks that come from a routine', () => {
  const task = (overrides: Record<string, unknown>) =>
    validateTaskFields({
      title: 't',
      notes: '',
      bucket: 'scheduled',
      date: '2026-03-10',
      time: null,
      deadline: null,
      priority: 0,
      project: null,
      tags: [],
      repeat: null,
      routineId: null,
      source: null,
      ...overrides
    }).map((i) => i.field)

  it('need bucket scheduled', () => {
    expect(task({ routineId: 'R1' })).toEqual([])
    expect(task({ routineId: 'R1', bucket: 'someday', date: null })).toEqual(['routineId'])
    expect(task({ routineId: 'R1', bucket: 'inbox', date: null })).toEqual(['routineId'])
  })
})

describe('the renderer cannot set routineId', () => {
  it('is rejected in new tasks and patches', () => {
    expect(parseTaskInput({ title: 'x', routineId: 'R1' })).toEqual({ ok: false, field: 'input' })
    expect(parseTaskPatch({ routineId: 'R1' })).toEqual({ ok: false, field: 'patch' })
    expect(parseTaskPatch({ title: 'ok' }).ok).toBe(true)
  })
})

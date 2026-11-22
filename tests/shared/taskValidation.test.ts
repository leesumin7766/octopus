import { describe, expect, it } from 'vitest'
import type { TaskFields } from '../../src/shared/tasks/types'
import {
  isValidDateString,
  TaskValidationError,
  validateTaskFields
} from '../../src/shared/validation/task'

function fields(overrides: Record<string, unknown> = {}): Record<keyof TaskFields, unknown> {
  return {
    title: '보고서 쓰기',
    notes: '',
    bucket: 'scheduled',
    date: '2026-03-10',
    time: '09:30',
    deadline: '2026-03-12',
    priority: 2,
    project: '업무',
    tags: ['a', 'b'],
    repeat: { freq: 'weekly', interval: 1, byWeekday: [1, 3] },
    routineId: null,
    source: { arm: 'google-calendar', ref: 'evt-1', url: 'https://example.com/e/1' },
    ...overrides
  }
}

function problemFields(overrides: Record<string, unknown>): string[] {
  return validateTaskFields(fields(overrides)).map((i) => i.field)
}

describe('validateTaskFields', () => {
  it('accepts valid input', () => {
    expect(validateTaskFields(fields())).toEqual([])
  })

  it('accepts a minimal inbox task', () => {
    const minimal = fields({
      bucket: 'inbox',
      date: null,
      time: null,
      deadline: null,
      priority: 0,
      project: null,
      tags: [],
      repeat: null,
      source: null
    })
    expect(validateTaskFields(minimal)).toEqual([])
  })

  it('rejects an empty or blank title', () => {
    expect(problemFields({ title: '' })).toEqual(['title'])
    expect(problemFields({ title: '   ' })).toEqual(['title'])
    expect(problemFields({ title: 3 })).toEqual(['title'])
  })

  it('rejects dates that do not exist', () => {
    expect(problemFields({ date: '2026-02-30' })).toEqual(['date'])
    expect(problemFields({ date: '2026-13-01' })).toEqual(['date'])
    expect(problemFields({ date: '2026-2-3' })).toEqual(['date'])
    expect(problemFields({ date: '2025-02-29' })).toEqual(['date'])
    expect(problemFields({ deadline: '2026-04-31' })).toEqual(['deadline'])
    expect(problemFields({ date: undefined })).toEqual(['date'])
  })

  it('accepts a leap day', () => {
    expect(isValidDateString('2024-02-29')).toBe(true)
    expect(problemFields({ date: '2024-02-29' })).toEqual([])
  })

  it('rejects bad times', () => {
    for (const time of ['25:00', '12:60', '9:00', '09:5', '0930']) {
      expect(problemFields({ time })).toEqual(['time'])
    }
    expect(problemFields({ time: '00:00' })).toEqual([])
    expect(problemFields({ time: '23:59' })).toEqual([])
  })

  it('rejects priority outside 0-3', () => {
    expect(problemFields({ priority: 4 })).toEqual(['priority'])
    expect(problemFields({ priority: -1 })).toEqual(['priority'])
    expect(problemFields({ priority: 1.5 })).toEqual(['priority'])
    expect(problemFields({ priority: '1' })).toEqual(['priority'])
  })

  it('requires a date when the bucket is scheduled', () => {
    const issues = validateTaskFields(fields({ bucket: 'scheduled', date: null }))

    expect(issues).toEqual([{ field: 'date', message: 'is required when bucket is scheduled' }])
  })

  it('requires no date when the bucket is inbox or someday', () => {
    expect(problemFields({ bucket: 'inbox', date: '2026-03-10' })).toEqual(['date'])
    expect(problemFields({ bucket: 'someday', date: '2026-03-10' })).toEqual(['date'])
    expect(problemFields({ bucket: 'someday', date: null })).toEqual([])
  })

  it('rejects an unknown bucket', () => {
    expect(problemFields({ bucket: 'later' })).toEqual(['bucket'])
  })

  it('rejects bad tags, repeat and source', () => {
    expect(problemFields({ tags: 'a' })).toEqual(['tags'])
    expect(problemFields({ tags: ['a', ''] })).toEqual(['tags'])
    expect(problemFields({ repeat: { freq: 'hourly', interval: 1 } })).toEqual(['repeat'])
    expect(problemFields({ repeat: { freq: 'daily', interval: 0 } })).toEqual(['repeat'])
    expect(problemFields({ repeat: { freq: 'weekly', interval: 1, byWeekday: [7] } })).toEqual(['repeat'])
    expect(problemFields({ repeat: { freq: 'monthly', interval: 1, byMonthDay: 32 } })).toEqual(['repeat'])
    expect(problemFields({ source: { arm: '', ref: 'x' } })).toEqual(['source'])
    expect(problemFields({ source: { arm: 'a', ref: 'x', url: 5 } })).toEqual(['source'])
  })

  it('reports every wrong field at once', () => {
    const issues = validateTaskFields(fields({ title: '', time: '25:00', priority: 9 }))

    expect(issues.map((i) => i.field).sort()).toEqual(['priority', 'time', 'title'])
  })
})

describe('TaskValidationError', () => {
  it('carries the issues and does not repeat input values in the message', () => {
    const error = new TaskValidationError([{ field: 'title', message: 'must be a non-empty string' }])

    expect(error.issues).toEqual([{ field: 'title', message: 'must be a non-empty string' }])
    expect(error.message).toBe('invalid task: title must be a non-empty string')
  })
})

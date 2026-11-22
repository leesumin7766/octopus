import { describe, expect, it } from 'vitest'
import { MAX_MEMO_LENGTH } from '../../src/shared/validation/memo'
import { MAX_SEARCH_LENGTH, parseMemoBody, parseSearchQuery } from '../../src/shared/validation/memoIpc'
import { parseHistoryDays, parseRoutineInput, parseRoutinePatch } from '../../src/shared/validation/routineIpc'

describe('parseRoutineInput', () => {
  it('needs a string title and an array of days, and only known fields', () => {
    const input = { title: '스트레칭', days: [1, 3], active: false }
    expect(parseRoutineInput(input)).toEqual({ ok: true, value: input })
    expect(parseRoutineInput({ title: 'a', days: [] }).ok).toBe(true) // 빈 배열은 저장소가 거부

    expect(parseRoutineInput({ days: [1] })).toEqual({ ok: false, field: 'title' })
    expect(parseRoutineInput({ title: 'a' })).toEqual({ ok: false, field: 'days' })
    expect(parseRoutineInput({ title: 'a', days: 3 })).toEqual({ ok: false, field: 'days' })
    expect(parseRoutineInput({ title: 'a', days: [1], id: 'x' })).toEqual({ ok: false, field: 'input' })
    for (const value of [null, 'x', 5, [], undefined]) {
      expect(parseRoutineInput(value)).toEqual({ ok: false, field: 'input' })
    }
  })

  it('rejects a __proto__ key', () => {
    const polluted = JSON.parse('{"title":"a","days":[1],"__proto__":{"x":1}}') as unknown
    expect(parseRoutineInput(polluted)).toEqual({ ok: false, field: 'input' })
  })
})

describe('parseRoutinePatch', () => {
  it('accepts known fields (even none) and rejects the rest', () => {
    expect(parseRoutinePatch({}).ok).toBe(true)
    expect(parseRoutinePatch({ title: 'a', days: [1], active: true }).ok).toBe(true)
    for (const key of ['id', 'order', 'createdAt', 'updatedAt', 'nope']) {
      expect(parseRoutinePatch({ [key]: 1 })).toEqual({ ok: false, field: 'patch' })
    }
    expect(parseRoutinePatch(null)).toEqual({ ok: false, field: 'patch' })
  })
})

describe('parseHistoryDays', () => {
  it('defaults to 14 when missing', () => {
    expect(parseHistoryDays(undefined)).toEqual({ ok: true, value: 14 })
    expect(parseHistoryDays(null)).toEqual({ ok: true, value: 14 })
  })

  it('accepts integers 1-90 only', () => {
    expect(parseHistoryDays(1)).toEqual({ ok: true, value: 1 })
    expect(parseHistoryDays(90)).toEqual({ ok: true, value: 90 })
    for (const days of [0, 91, -1, 1.5, '14', NaN, Infinity, {}]) {
      expect(parseHistoryDays(days)).toEqual({ ok: false, field: 'days' })
    }
  })
})

describe('memo input', () => {
  it('parseMemoBody: a string up to the limit (blank is left to the repository)', () => {
    expect(parseMemoBody('본문')).toEqual({ ok: true, value: '본문' })
    expect(parseMemoBody('').ok).toBe(true)
    expect(parseMemoBody('x'.repeat(MAX_MEMO_LENGTH)).ok).toBe(true)
    expect(parseMemoBody('x'.repeat(MAX_MEMO_LENGTH + 1))).toEqual({ ok: false, field: 'body' })
    expect(parseMemoBody(5)).toEqual({ ok: false, field: 'body' })
  })

  it('parseSearchQuery: a string up to the limit', () => {
    expect(parseSearchQuery('')).toEqual({ ok: true, value: '' })
    expect(parseSearchQuery('x'.repeat(MAX_SEARCH_LENGTH)).ok).toBe(true)
    expect(parseSearchQuery('x'.repeat(MAX_SEARCH_LENGTH + 1))).toEqual({ ok: false, field: 'query' })
    expect(parseSearchQuery(null)).toEqual({ ok: false, field: 'query' })
  })
})

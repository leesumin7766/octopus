import { describe, expect, it } from 'vitest'
import { createUlidGenerator } from '../../src/shared/tasks/ulid'
import {
  isUlid,
  MAX_IDS,
  MAX_TEXT_LENGTH,
  parseId,
  parseIds,
  parseStatus,
  parseTaskInput,
  parseTaskPatch,
  parseText,
  parseView
} from '../../src/shared/validation/taskIpc'

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

describe('isUlid / parseId', () => {
  it('accepts generated ULIDs', () => {
    const ulid = createUlidGenerator()
    expect(isUlid(ulid(Date.now()))).toBe(true)
    expect(parseId(ID)).toEqual({ ok: true, value: ID })
  })

  it('rejects everything else', () => {
    for (const value of ['', 'abc', ID.toLowerCase(), ID + 'A', ID.slice(1), 'I' + ID.slice(1), 'U' + ID.slice(1), 123, null, undefined, {}]) {
      expect(isUlid(value)).toBe(false)
    }
    expect(parseId('nope')).toEqual({ ok: false, field: 'id' })
  })
})

describe('parseView', () => {
  it('accepts the five views only', () => {
    for (const view of ['inbox', 'today', 'upcoming', 'someday', 'done']) {
      expect(parseView(view)).toEqual({ ok: true, value: view })
    }
    for (const view of ['weekly', '', 'Inbox', 5, null, undefined, ['inbox']]) {
      expect(parseView(view)).toEqual({ ok: false, field: 'view' })
    }
  })
})

describe('parseIds', () => {
  it('accepts an array of ULIDs up to the limit', () => {
    expect(parseIds([])).toEqual({ ok: true, value: [] })
    expect(parseIds([ID])).toEqual({ ok: true, value: [ID] })
    expect(parseIds(Array.from({ length: MAX_IDS }, () => ID)).ok).toBe(true)
  })

  it('rejects too many, non-ULIDs and non-arrays', () => {
    expect(parseIds(Array.from({ length: MAX_IDS + 1 }, () => ID))).toEqual({ ok: false, field: 'ids' })
    expect(parseIds([ID, 'bad'])).toEqual({ ok: false, field: 'ids' })
    expect(parseIds(ID)).toEqual({ ok: false, field: 'ids' })
    expect(parseIds(null)).toEqual({ ok: false, field: 'ids' })
  })
})

describe('parseText', () => {
  it('accepts strings up to the limit, including empty', () => {
    expect(parseText('')).toEqual({ ok: true, value: '' })
    expect(parseText('x'.repeat(MAX_TEXT_LENGTH)).ok).toBe(true)
  })

  it('rejects long text and non-strings', () => {
    expect(parseText('x'.repeat(MAX_TEXT_LENGTH + 1))).toEqual({ ok: false, field: 'text' })
    expect(parseText(1)).toEqual({ ok: false, field: 'text' })
    expect(parseText(undefined)).toEqual({ ok: false, field: 'text' })
  })
})

describe('parseStatus', () => {
  it('accepts the three statuses only', () => {
    for (const status of ['open', 'done', 'canceled']) expect(parseStatus(status).ok).toBe(true)
    expect(parseStatus('archived')).toEqual({ ok: false, field: 'status' })
    expect(parseStatus(undefined)).toEqual({ ok: false, field: 'status' })
  })
})

describe('parseTaskInput', () => {
  it('accepts known fields with a title', () => {
    const input = { title: '보고서', date: '2026-03-10', priority: 2, tags: ['a'] }
    expect(parseTaskInput(input)).toEqual({ ok: true, value: input })
  })

  it('rejects unknown fields, a missing title and non-objects', () => {
    expect(parseTaskInput({ title: 'x', id: ID })).toEqual({ ok: false, field: 'input' })
    expect(parseTaskInput({ title: 'x', status: 'done' })).toEqual({ ok: false, field: 'input' })
    expect(parseTaskInput({})).toEqual({ ok: false, field: 'title' })
    expect(parseTaskInput({ title: 5 })).toEqual({ ok: false, field: 'title' })
    for (const value of [null, 'x', 5, ['title'], undefined, new Map()]) {
      expect(parseTaskInput(value)).toEqual({ ok: false, field: 'input' })
    }
  })

  it('rejects a __proto__ key', () => {
    const polluted = JSON.parse('{"title":"x","__proto__":{"admin":true}}') as unknown
    expect(parseTaskInput(polluted)).toEqual({ ok: false, field: 'input' })
  })
})

describe('parseTaskPatch', () => {
  it('accepts known fields, including an empty patch', () => {
    expect(parseTaskPatch({ title: 'x', notes: '' }).ok).toBe(true)
    expect(parseTaskPatch({}).ok).toBe(true)
  })

  it('rejects fields a patch must not change, and unknown ones', () => {
    for (const key of ['id', 'status', 'order', 'createdAt', 'updatedAt', 'doneAt', 'nope']) {
      expect(parseTaskPatch({ [key]: 1 })).toEqual({ ok: false, field: 'patch' })
    }
    expect(parseTaskPatch(null)).toEqual({ ok: false, field: 'patch' })
    expect(parseTaskPatch('x')).toEqual({ ok: false, field: 'patch' })
    expect(parseTaskPatch([])).toEqual({ ok: false, field: 'patch' })
  })
})

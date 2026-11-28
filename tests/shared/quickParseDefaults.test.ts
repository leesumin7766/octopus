import { describe, expect, it } from 'vitest'
import { parseQuickInput } from '../../src/shared/tasks/quickParse'
import { parseQuickOptions } from '../../src/shared/validation/taskIpc'

const TODAY = '2026-11-22' // 일요일
const DAY = '2026-11-30' // 월요일

describe('parseQuickInput defaults (날짜 상세 입력)', () => {
  it('without options the result is the same as before (dateFrom only added)', () => {
    expect(parseQuickInput('3시 회의', TODAY)).toMatchObject({ date: TODAY, time: '15:00', dateFrom: null })
    expect(parseQuickInput('회의', TODAY)).toMatchObject({ date: null, bucket: 'inbox', dateFrom: null })
  })

  it('no date in the text → defaultDate', () => {
    expect(parseQuickInput('회의', TODAY, { defaultDate: DAY })).toMatchObject({ title: '회의', date: DAY, time: null, bucket: 'scheduled', dateFrom: 'default' })
  })

  it('time only → defaultDate, not today', () => {
    expect(parseQuickInput('3시 회의', TODAY, { defaultDate: DAY })).toMatchObject({ date: DAY, time: '15:00', dateFrom: 'default' })
  })

  it('a date in the text wins', () => {
    expect(parseQuickInput('내일 회의', TODAY, { defaultDate: DAY })).toMatchObject({ date: '2026-11-23', dateFrom: 'text' })
  })

  it('defaultTime is used only when the text has no time', () => {
    expect(parseQuickInput('회의', TODAY, { defaultDate: DAY, defaultTime: '10:00' }).time).toBe('10:00')
    expect(parseQuickInput('3시 회의', TODAY, { defaultDate: DAY, defaultTime: '10:00' }).time).toBe('15:00')
  })

  it('a repeat starts counting from defaultDate', () => {
    // 11/30(월) 기준 "매주 월" 의 첫 회차는 그날 자체
    const result = parseQuickInput('매주 월 회의', TODAY, { defaultDate: DAY })
    expect(result.date).toBe(DAY)
    expect(result.repeat).toMatchObject({ freq: 'weekly', anchor: DAY })
    expect(result.dateFrom).toBe('default')
    // 기준일과 다른 요일이면 그 뒤 첫 회차(문장에서 정해진 날짜)
    expect(parseQuickInput('매주 수 회의', TODAY, { defaultDate: DAY })).toMatchObject({ date: '2026-12-02', dateFrom: null })
  })
})

describe('parseQuickOptions', () => {
  it('accepts nothing, or valid defaults', () => {
    expect(parseQuickOptions(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseQuickOptions({ defaultDate: DAY, defaultTime: '09:05' })).toEqual({ ok: true, value: { defaultDate: DAY, defaultTime: '09:05' } })
  })

  it.each([
    ['not an object', 'x'],
    ['unknown key', { other: 1 }],
    ['bad date', { defaultDate: '2026-02-30' }],
    ['bad time', { defaultTime: '25:00' }],
    ['time not a string', { defaultTime: 900 }]
  ])('rejects %s', (_name, value) => {
    expect(parseQuickOptions(value).ok).toBe(false)
  })
})

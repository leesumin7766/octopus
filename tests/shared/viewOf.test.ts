import { describe, expect, it } from 'vitest'
import { viewOf } from '../../src/shared/tasks/viewOf'

const TODAY = '2026-11-25'
const open = { status: 'open', bucket: 'scheduled', date: TODAY } as const

describe('viewOf', () => {
  it('done and canceled tasks are in 완료', () => {
    expect(viewOf({ ...open, status: 'done' }, TODAY)).toBe('done')
    expect(viewOf({ ...open, status: 'canceled' }, TODAY)).toBe('done')
  })

  it('someday wins over everything for open tasks', () => {
    expect(viewOf({ status: 'open', bucket: 'someday', date: null }, TODAY)).toBe('someday')
  })

  it('no date is the inbox', () => {
    expect(viewOf({ status: 'open', bucket: 'inbox', date: null }, TODAY)).toBe('inbox')
  })

  it('today and earlier dates are 오늘 (overdue included); later dates are 예정', () => {
    expect(viewOf(open, TODAY)).toBe('today')
    expect(viewOf({ ...open, date: '2026-11-24' }, TODAY)).toBe('today')
    expect(viewOf({ ...open, date: '2026-11-26' }, TODAY)).toBe('upcoming')
  })
})

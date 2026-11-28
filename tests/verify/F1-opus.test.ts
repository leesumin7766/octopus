// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// F1 독립 검증(Opus): 날짜 상세·달력 탭의 추가 칸도 자연어를 알아듣는다. 그 날짜가 기본, 문장 날짜가 이긴다. 시각 칸은 문장에 시각이 없을 때만.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import type { IpcResult } from '../../src/shared/ipc'
import { parseQuickInput } from '../../src/shared/tasks/quickParse'
import type { Task } from '../../src/shared/tasks/types'
import { parseQuickOptions } from '../../src/shared/validation/taskIpc'
import { installBackend, type Backend } from '../renderer/backend'

const TODAY = '2026-11-26' // 목요일
const D = '2026-11-30' // 월요일, 날짜 상세에서 연 날

describe('F1 (Opus) parser', () => {
  const samples = ['회의', '내일 3시 회의 #업무 !높음', '3시 회의', '매주 월 회의', '매월 15일 정산', '오후 2시', '다음주 수 점심']

  it('without options every sample parses exactly as before (only dateFrom is added)', () => {
    for (const text of samples) {
      const a = parseQuickInput(text, TODAY)
      const b = parseQuickInput(text, TODAY, undefined)
      const c = parseQuickInput(text, TODAY, {})
      expect(b).toEqual(a)
      expect(c).toEqual(a)
      expect(a.dateFrom === null ? a.date === null || a.repeat !== null || a.time !== null : a.dateFrom === 'text').toBe(true)
    }
  })

  it('no date in the sentence → defaultDate (also when only a time is given)', () => {
    expect(parseQuickInput('회의', TODAY, { defaultDate: D })).toMatchObject({ title: '회의', date: D, dateFrom: 'default', bucket: 'scheduled' })
    expect(parseQuickInput('3시 회의', TODAY, { defaultDate: D })).toMatchObject({ title: '회의', date: D, time: '15:00' })
  })

  it('a date in the sentence wins over defaultDate', () => {
    expect(parseQuickInput('내일 회의', TODAY, { defaultDate: D })).toMatchObject({ date: '2026-11-27', dateFrom: 'text' })
    expect(parseQuickInput('12월 3일 회의', TODAY, { defaultDate: D }).date).toBe('2026-12-03')
  })

  it('defaultTime is used only when the sentence has no time', () => {
    expect(parseQuickInput('회의', TODAY, { defaultDate: D, defaultTime: '10:00' }).time).toBe('10:00')
    expect(parseQuickInput('3시 회의', TODAY, { defaultDate: D, defaultTime: '10:00' }).time).toBe('15:00')
    expect(parseQuickInput('오전 9시 회의', TODAY, { defaultDate: D, defaultTime: '10:00' }).time).toBe('09:00')
  })

  it('a repeat without a date starts from defaultDate, not from today', () => {
    expect(parseQuickInput('매주 월 회의', TODAY, { defaultDate: D }).date).toBe(D)
    expect(parseQuickInput('매주 월 회의', TODAY, { defaultDate: '2026-12-01' }).date).toBe('2026-12-07')
    expect(parseQuickInput('매주 월 회의', TODAY).date).toBe(D) // 옵션 없으면 오늘 기준 다음 월요일
  })

  it('main rejects bad options before parsing', () => {
    expect(parseQuickOptions(undefined)).toMatchObject({ ok: true })
    expect(parseQuickOptions({ defaultDate: D, defaultTime: '23:59' })).toMatchObject({ ok: true, value: { defaultDate: D, defaultTime: '23:59' } })
    for (const bad of [null, 'x', [], { other: 1 }, { defaultDate: '2026-02-30' }, { defaultDate: 20261130 }, { defaultTime: '24:00' }, { defaultTime: '9:00' }]) {
      expect(parseQuickOptions(bad).ok).toBe(false)
    }
  })
})

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

describe('F1 (Opus) date detail input', () => {
  let b: Backend
  const m = ko.home.localCalendar
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
    b = installBackend('home')
  })
  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  const grid = (): HTMLElement => screen.getByRole('region', { name: ko.calendarScreen.title })
  const cell = (date: string): HTMLElement => grid().querySelector(`[data-date="${date}"]`) as HTMLElement
  const all = (): Task[] => b.t.repo.listRange('2026-11-01', '2026-12-31')
  const find = (title: string): Task | undefined => all().find((task) => task.title === title)

  async function openDay() {
    const user = userEvent.setup()
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.calendar }))
    await screen.findByRole('heading', { level: 1, name: ko.calendarScreen.title })
    await user.click(cell(D))
    const day = await screen.findByRole('region', { name: '2026년 11월 30일 (월)' })
    const input = within(day).getByLabelText(m.addLabel) as HTMLInputElement
    const time = within(day).getByLabelText(ko.tasks.timeFieldLabel) as HTMLInputElement
    return { user, day, input, time }
  }

  it('"3시 회의" → that day at 15:00, input cleared', async () => {
    const { user, input } = await openDay()
    await user.type(input, '3시 회의{Enter}')
    await waitFor(() => expect(find('회의')).toMatchObject({ date: D, time: '15:00' }))
    expect(input.value).toBe('')
  })

  it('preview shows 이 날짜 without a sentence date, and marks a different sentence date', async () => {
    const { user, day, input } = await openDay()
    await user.type(input, '회의')
    await waitFor(() => expect(within(day).getByRole('list', { name: ko.tasks.previewLabel }).textContent).toContain(ko.tasks.chip.thisDate))
    await user.clear(input)
    await user.type(input, '내일 회의')
    await waitFor(() => expect(within(day).getByRole('list', { name: ko.tasks.previewLabel }).textContent).toContain('(문장)'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(find('회의')?.date).toBe('2026-11-27'))
  })

  it('time field 10:00: "회의" → 10:00, "3시 회의2" → 15:00 (sentence wins)', async () => {
    const { user, input, time } = await openDay()
    await user.type(time, '10:00')
    await user.type(input, '회의{Enter}')
    await waitFor(() => expect(find('회의')).toMatchObject({ date: D, time: '10:00' }))
    await user.type(time, '10:00')
    await user.type(input, '3시 회의2{Enter}')
    await waitFor(() => expect(find('회의2')).toMatchObject({ date: D, time: '15:00' }))
  })

  it('a failed save keeps the text and shows the error', async () => {
    const { user, day, input } = await openDay()
    let release!: (v: IpcResult<Task>) => void
    b.tasks.quickAdd.mockImplementationOnce(() => new Promise<IpcResult<Task>>((resolve) => (release = resolve)))
    await user.type(input, '실패할 일{Enter}')
    await act(async () => release({ ok: false, error: { code: 'internal' } }))
    expect(await within(day).findByRole('alert')).toBeTruthy()
    expect(input.value).toBe('실패할 일')
    expect(find('실패할 일')).toBeUndefined()
  })

  it('the date detail sends defaultDate; home quick input still sends no options (inbox)', async () => {
    const { user, input } = await openDay()
    await user.type(input, '상세 일{Enter}')
    await waitFor(() => expect(b.tasks.quickAdd).toHaveBeenCalledWith('상세 일', expect.objectContaining({ defaultDate: D })))
    cleanup()
    b.tasks.quickAdd.mockClear()
    render(createElement(App))
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.type(within(card).getByLabelText(ko.tasks.quickInputLabel), '홈 보고서{Enter}')
    await waitFor(() => expect(b.tasks.quickAdd).toHaveBeenCalledTimes(1))
    expect(b.tasks.quickAdd.mock.calls[0].length === 1 || b.tasks.quickAdd.mock.calls[0][1] === undefined).toBe(true)
    await waitFor(() => expect(b.t.repo.listView('inbox', TODAY)).toEqual(expect.arrayContaining([expect.objectContaining({ title: '홈 보고서', date: null })])))
  })

  it('a draft in the detail is not dropped when another day is clicked', async () => {
    const { user, day, input } = await openDay()
    await user.type(input, '쓰던 글')
    await user.click(cell('2026-12-01'))
    expect(within(day).getByRole('heading', { name: '2026년 11월 30일 (월)' })).toBeTruthy()
    expect(input.value).toBe('쓰던 글')
  })
})

// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// C1 독립 검증(Opus): 달력 탭의 달·선택 날짜는 오른쪽 패널이 실제로 날짜를 옮겼을 때만 바뀐다.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import type { IpcResult } from '../../src/shared/ipc'
import type { Task } from '../../src/shared/tasks/types'
import { installBackend, type Backend } from '../renderer/backend'

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

const m = ko.home.localCalendar
const T = '2026-11-26'
let b: Backend

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
const panel = (title: string): Promise<HTMLElement> => screen.findByRole('region', { name: title })
const month = (label: string): void => {
  expect(within(grid()).getByText(label)).toBeTruthy()
}

async function open() {
  const user = userEvent.setup()
  render(createElement(App))
  await screen.findByRole('region', { name: ko.home.cards.todo })
  await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.calendar }))
  await screen.findByRole('heading', { level: 1, name: ko.calendarScreen.title })
  return user
}

describe('C1 (Opus)', () => {
  it('without a draft, 오늘 from another month moves the panel and the month at once', async () => {
    const user = await open()
    await user.click(cell('2026-11-30'))
    await panel('2026년 11월 30일 (월)')
    await user.click(within(grid()).getByRole('button', { name: m.nextMonth }))
    await user.click(within(grid()).getByRole('button', { name: m.nextMonth }))
    month('2027년 1월')
    await user.click(within(grid()).getByRole('button', { name: m.today }))
    await panel('2026년 11월 26일 (목) · 오늘')
    month('2026년 11월')
    expect(cell(T).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(m.discardTitle)).toBeNull()
  })

  it('today already selected and drafting while paged away: 오늘 only brings the month back, no question, draft kept', async () => {
    const user = await open()
    const day = await panel('2026년 11월 26일 (목) · 오늘')
    await user.type(within(day).getByLabelText(m.addLabel), '쓰는 중')
    await user.click(within(grid()).getByRole('button', { name: m.prevMonth }))
    month('2026년 10월')
    await user.click(within(grid()).getByRole('button', { name: m.today }))
    month('2026년 11월')
    expect(screen.queryByText(m.discardTitle)).toBeNull()
    expect((within(day).getByLabelText(m.addLabel) as HTMLInputElement).value).toBe('쓰는 중')
  })

  it('a next-month spill cell while drafting: [계속 쓰기] keeps month and selection, [버리기] follows to that month', async () => {
    const user = await open()
    const day = await panel('2026년 11월 26일 (목) · 오늘')
    await user.type(within(day).getByLabelText(m.addLabel), '초안')
    // 11월 격자 끝에 보이는 12월 날짜
    const spill = cell('2026-12-02') ?? cell('2026-12-01')
    expect(spill).toBeTruthy()
    const spillDate = spill.getAttribute('data-date')!
    await user.click(spill)
    await user.click(within(day).getByRole('button', { name: m.discardNo }))
    month('2026년 11월')
    expect(cell(T).getAttribute('aria-pressed')).toBe('true')
    expect(within(day).getByRole('heading', { name: '2026년 11월 26일 (목) · 오늘' })).toBeTruthy()

    await user.click(cell(spillDate))
    await user.click(within(day).getByRole('button', { name: m.discardYes }))
    month('2026년 12월')
    expect(cell(spillDate).getAttribute('aria-pressed')).toBe('true')
    expect((within(day).getByLabelText(m.addLabel) as HTMLInputElement).value).toBe('')
  })

  it('while an add is still saving, 오늘 from another month changes nothing', async () => {
    const user = await open()
    await user.click(cell('2026-11-30'))
    const day = await panel('2026년 11월 30일 (월)')
    let release!: (v: IpcResult<Task>) => void
    b.tasks.create.mockImplementationOnce(() => new Promise<IpcResult<Task>>((resolve) => (release = resolve)))
    await user.type(within(day).getByLabelText(m.addLabel), '저장 중{Enter}')
    await user.click(within(grid()).getByRole('button', { name: m.nextMonth }))
    month('2026년 12월')
    await user.click(within(grid()).getByRole('button', { name: m.today }))
    month('2026년 12월')
    expect(within(day).getByText(m.busyNav)).toBeTruthy()
    expect(within(day).getByRole('heading', { name: '2026년 11월 30일 (월)' })).toBeTruthy()
    await act(async () => release({ ok: false, error: { code: 'internal' } }))
  })
})

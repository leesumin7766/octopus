// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// C2 독립 검증(Opus): 달력 탭 Google 일정. 늦게 온 옛 실패가 새 성공을 덮지 않고, 탭을 떠나면 다시 읽기가 멈춘다.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import type { IpcResult } from '../../src/shared/ipc'
import type { CalendarToday } from '../../src/shared/calendar/types'
import { installBackend, type Backend } from '../renderer/backend'

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

const event = (title: string) => ({ id: `e-${title}`, title, start: '2026-11-26T10:00:00+09:00', end: '2026-11-26T11:00:00+09:00', allDay: false })
const on = (titles: string[]): CalendarToday => ({ configured: true, status: { state: 'on' }, events: titles.map(event) as CalendarToday['events'] })

let b: Backend
let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  b = installBackend('home')
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

async function openCalendarTab(): Promise<void> {
  render(createElement(App))
  await screen.findByRole('region', { name: ko.home.cards.todo })
  await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.calendar }))
  await screen.findByRole('heading', { level: 1, name: ko.calendarScreen.title })
}

describe('C2 (Opus)', () => {
  it('an older read that fails late does not replace a newer successful read', async () => {
    const holds: ((r: IpcResult<CalendarToday>) => void)[] = []
    b.calendar.today.mockImplementation(() => new Promise((resolve) => holds.push(resolve)) as never)
    await openCalendarTab()
    await waitFor(() => expect(holds.length).toBeGreaterThan(0))
    const before = holds.length
    // 창 포커스로 새 읽기를 하나 더 시작한다.
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(holds.length).toBeGreaterThan(before))
    // 새 읽기가 먼저 성공, 옛 읽기는 늦게 실패.
    await act(async () => holds[holds.length - 1]({ ok: true, data: on(['새 회의']) }))
    expect(await screen.findByText('새 회의')).toBeTruthy()
    await act(async () => holds[before - 1]({ ok: false, error: { code: 'internal' } }))
    expect(screen.getByText('새 회의')).toBeTruthy()
    expect(screen.queryByRole('button', { name: ko.home.calendar.retry })).toBeNull()
  })

  it('leaving the calendar tab stops its periodic reads', async () => {
    b.calendar.today.mockResolvedValue({ ok: true, data: on([]) })
    await openCalendarTab()
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.memos }))
    await screen.findByLabelText(ko.memos.newLabel)
    const calls = b.calendar.today.mock.calls.length
    await act(async () => void vi.advanceTimersByTime(5 * 60_000))
    expect(b.calendar.today.mock.calls.length).toBe(calls)
  })

  it('a failed read offers [다시 시도], and the retry happens at once (not on the next minute)', async () => {
    // 홈도 일정을 읽으므로, 다시 시도를 누르기 전까지는 모든 읽기가 실패하게 둔다.
    b.calendar.today.mockResolvedValue({ ok: false, error: { code: 'internal' } })
    await openCalendarTab()
    const retry = await screen.findByRole('button', { name: ko.home.calendar.retry })
    b.calendar.today.mockResolvedValue({ ok: true, data: on(['다시 읽은 회의']) })
    const calls = b.calendar.today.mock.calls.length
    await user.click(retry)
    expect(b.calendar.today.mock.calls.length).toBe(calls + 1)
    expect(await screen.findByText('다시 읽은 회의')).toBeTruthy()
  })
})

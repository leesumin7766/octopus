// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import type { CalendarToday } from '../../src/shared/calendar/types'
import { installBackend, type Backend } from './backend'

// C2: 달력 탭의 Google 일정 상태 — 불러오는 중 / 연결 안 됨([연결하기]) / 실패([다시 시도]) / 일정 없음 / 있음을 구분한다.
// 홈과 같은 주기로(포커스·자정·1분) 다시 읽고, 늦게 온 응답이 새 응답을 덮지 않으며, 원본 열기가 실패하면 알린다.
const c = ko.home.calendar
const m = ko.home.localCalendar

describe('calendar tab: Google events states', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const on = (events: CalendarToday['events'] = []): CalendarToday => ({ configured: true, status: { state: 'on' }, events })
  const section = (): HTMLElement | null => screen.queryByRole('region', { name: m.googleSection })

  async function openTab(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.calendar }))
    await screen.findByRole('heading', { level: 1, name: ko.calendarScreen.title })
    return user
  }

  it('loading: while the first read is pending the section says so', async () => {
    b = installBackend('home')
    let release!: (value: unknown) => void
    b.calendar.today.mockImplementation(() => new Promise((resolve) => (release = resolve)) as never)
    await openTab()
    expect(within(section()!).getByText(c.loading)).toBeTruthy()
    await act(async () => release({ ok: true, data: on() }))
    expect(await within(section()!).findByText(c.noEvents)).toBeTruthy()
  })

  it('not connected: says so with a [연결하기] button that starts the connection', async () => {
    const user = (b = installBackend('home'), await openTab())
    expect(within(section()!).getByText(c.notConnected)).toBeTruthy()
    await user.click(within(section()!).getByRole('button', { name: c.connect }))
    await waitFor(() => expect(b.arms.connect).toHaveBeenCalledWith('google-calendar'))
  })

  it('not configured: nothing is shown (connecting is on the Arms screen)', async () => {
    b = installBackend('home')
    b.calendarState.configured = false
    await openTab()
    expect(section()).toBeNull()
  })

  it('no events and with events', async () => {
    b = installBackend('home')
    Object.assign(b.calendarState, on())
    await openTab()
    expect(await within(section()!).findByText(c.noEvents)).toBeTruthy()
    cleanup()
    b.t.db.close()

    b = installBackend('home')
    Object.assign(b.calendarState, on([{ id: 'e1', title: '팀 점심', start: '2026-11-26', end: '2026-11-27', allDay: true, url: 'https://calendar.google.com/e1' }]))
    await openTab()
    expect(await within(section()!).findByText('팀 점심')).toBeTruthy()
  })

  it('failure → [다시 시도] → success', async () => {
    b = installBackend('home')
    b.calendar.today.mockResolvedValue({ ok: false, error: { code: 'internal' } })
    const user = await openTab()
    expect(await within(section()!).findByRole('alert')).toBeTruthy()
    expect(within(section()!).getByText(c.loadFailed)).toBeTruthy()

    b.calendar.today.mockResolvedValue({ ok: true, data: on() })
    await user.click(within(section()!).getByRole('button', { name: c.retry }))
    expect(await within(section()!).findByText(c.noEvents)).toBeTruthy()
    expect(within(section()!).queryByRole('alert')).toBeNull()
  })

  it('an older response arriving late does not overwrite a newer one', async () => {
    b = installBackend('home')
    Object.assign(b.calendarState, on())
    const resolvers: ((value: unknown) => void)[] = []
    b.calendar.today.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)) as never)
    await openTab() // 1번째 읽기(대기)
    await waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(1))
    const before = resolvers.length
    fireEvent.focus(window) // 2번째 읽기
    await waitFor(() => expect(resolvers.length).toBeGreaterThan(before))

    const newest = resolvers[resolvers.length - 1]
    await act(async () => newest({ ok: true, data: on([{ id: 'n', title: '새 응답 일정', start: '2026-11-26', end: '2026-11-27', allDay: true, url: null }]) }))
    expect(await within(section()!).findByText('새 응답 일정')).toBeTruthy()
    // 먼저 시작한 읽기가 늦게 도착해도(일정 없음) 새 결과가 그대로다
    await act(async () => resolvers[0]({ ok: true, data: on() }))
    expect(within(section()!).getByText('새 응답 일정')).toBeTruthy()
    expect(within(section()!).queryByText(c.noEvents)).toBeNull()
  })

  it('reads again when the window gets focus', async () => {
    b = installBackend('home')
    await openTab()
    const before = b.calendar.today.mock.calls.length
    fireEvent.focus(window)
    await waitFor(() => expect(b.calendar.today.mock.calls.length).toBeGreaterThan(before))
  })

  it('reads again after midnight (fake clock)', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 26, 23, 59, 0))
    b = installBackend('home')
    await openTab()
    const before = b.calendar.today.mock.calls.length
    await act(async () => void vi.advanceTimersByTime(2 * 60_000 + 1000)) // 자정 + 1초를 지난다
    await waitFor(() => expect(b.calendar.today.mock.calls.length).toBeGreaterThan(before))
  })

  it('opening the original fails → a short notice', async () => {
    b = installBackend('home')
    Object.assign(b.calendarState, on([{ id: 'e1', title: '열 일정', start: '2026-11-26', end: '2026-11-27', allDay: true, url: 'https://calendar.google.com/e1' }]))
    b.calendar.openEvent.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    const user = await openTab()
    await user.click(await within(await screen.findByRole('region', { name: m.googleSection })).findByRole('button', { name: c.eventLabel('열 일정') }))
    expect(await screen.findByText(c.openFailed)).toBeTruthy()
  })
})

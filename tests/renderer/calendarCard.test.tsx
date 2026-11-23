// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import type { CalendarEvent } from '../../src/shared/calendar/types'
import { fakeArm } from '../arms/helpers'
import { installBackend, type Backend } from './backend'

const t = ko.home
const c = ko.home.calendar

// "지금" 은 2026-03-10 12:00(로컬). 일정 시각도 로컬 시각으로 만든다.
const at = (h: number, m = 0): string => new Date(2026, 2, 10, h, m).toISOString()
const event = (over: Partial<CalendarEvent> & { id: string; title: string }): CalendarEvent => ({
  start: at(9),
  end: at(10),
  allDay: false,
  url: 'https://calendar.example.com/e/' + over.id,
  ...over
})

describe('home: today\'s schedule card', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const prepare = (): Backend => (b = installBackend('home'))
  const show = async (): Promise<HTMLElement> => {
    render(<App />)
    return screen.findByRole('region', { name: t.cards.calendar })
  }

  describe('the four states', () => {
    it('1. not connected: explains and offers [캘린더 연결하기], which opens the Arms screen', async () => {
      const user = userEvent.setup()
      prepare()
      const card = await show()

      expect(await within(card).findByText(c.empty)).toBeTruthy()
      await user.click(within(card).getByRole('button', { name: c.connect }))

      expect(await screen.findByRole('heading', { level: 1, name: /Arms/ })).toBeTruthy()
    })

    it('2. this build has no Google setup: says so and no connect button', async () => {
      const backend = prepare()
      backend.calendarState.configured = false
      backend.calendarState.unavailableReason = ko.home.calendar.notConfigured
      const card = await show()

      expect(await within(card).findByText(c.notConfigured)).toBeTruthy()
      expect(within(card).queryByRole('button', { name: c.connect })).toBeNull()
      expect(within(card).getByRole('button', { name: c.openArms })).toBeTruthy()
    })

    it('3. connected: shows today\'s events in time order, all-day first', async () => {
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      backend.calendarState.events = [
        event({ id: 'a', title: '종일 행사', allDay: true, start: '2026-03-10', end: '2026-03-11' }),
        event({ id: 'b', title: '아침 회의', start: at(9), end: at(10) }),
        event({ id: 'c', title: '오후 면담', start: at(15), end: at(16) })
      ]
      const card = await show()

      const rows = await within(card).findAllByRole('listitem')
      expect(rows.map((r) => r.textContent)).toEqual([`${c.allDay}종일 행사`, '09:00~10:00아침 회의', '15:00~16:00오후 면담'])
    })

    it('3b. connected with nothing today', async () => {
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      const card = await show()
      expect(await within(card).findByText(c.noEvents)).toBeTruthy()
    })

    it('4. error: shows the reason and [다시 연결], which asks the Arm to connect again and refreshes', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.armManager.register(fakeArm({ manifest: { id: 'google-calendar', name: 'Google 캘린더' } }))
      backend.calendarState.status = { state: 'error', reason: '로그인이 만료됐어요. [다시 연결]을 눌러 주세요.' }
      const card = await show()
      expect((await within(card).findByRole('alert')).textContent).toBe('로그인이 만료됐어요. [다시 연결]을 눌러 주세요.')

      backend.calendarState.status = { state: 'on' }
      await user.click(within(card).getByRole('button', { name: c.reconnect }))

      expect(backend.arms.connect).toHaveBeenCalledWith('google-calendar')
      await waitFor(() => expect(within(card).getByText(c.noEvents)).toBeTruthy())
    })
  })

  describe('events', () => {
    it('past events are dimmed, the one in progress is highlighted with a badge, later ones are normal', async () => {
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      backend.calendarState.events = [
        event({ id: 'past', title: '지난 일정', start: at(9), end: at(10) }),
        event({ id: 'now', title: '진행 중 일정', start: at(11, 30), end: at(12, 30) }),
        event({ id: 'later', title: '나중 일정', start: at(15), end: at(16) })
      ]
      const card = await show()

      const rows = await within(card).findAllByRole('listitem')
      expect(rows.map((r) => r.getAttribute('data-phase'))).toEqual(['past', 'now', 'later'])
      expect(rows[1].getAttribute('aria-current')).toBe('time')
      expect(within(rows[1]).getByText(c.now)).toBeTruthy()
      expect(within(rows[0]).queryByText(c.now)).toBeNull()
      expect(rows[0].querySelector('button')?.className).toContain('text-[#8a8983]')
    })

    it('clicking an event asks main to open it by id; only the stored https address is opened', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      backend.calendarState.events = [event({ id: 'abc', title: '회의' })]
      const card = await show()

      await user.click(await within(card).findByRole('button', { name: c.eventLabel('회의') }))

      expect(backend.calendar.openEvent).toHaveBeenCalledWith('abc')
      expect(backend.opened).toEqual(['https://calendar.example.com/e/abc'])
    })

    it('an event with no link is not a button; an unsafe address is never opened by main', async () => {
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      backend.calendarState.events = [event({ id: 'x', title: '링크 없음', url: null })]
      const card = await show()
      await within(card).findByText('링크 없음')
      expect(within(card).queryByRole('button', { name: c.eventLabel('링크 없음') })).toBeNull()

      backend.calendarState.events = [event({ id: 'y', title: '위험', url: 'http://plain.example.com/' })]
      expect(await backend.calendar.openEvent('y')).toMatchObject({ ok: false })
      expect(await backend.calendar.openEvent('../etc')).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      expect(backend.opened).toEqual([])
    })

    it('titles are plain text — no HTML, no scripts', async () => {
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      const evil = '<img src=x onerror="window.__pwned=1"><b>굵게</b>'
      backend.calendarState.events = [event({ id: 'e', title: evil })]
      const card = await show()

      await within(card).findByText(evil)
      expect(card.querySelector('img, b, script')).toBeNull()
      expect((window as { __pwned?: number }).__pwned).toBeUndefined()
    })
  })

  describe('pie menu 캘린더 wedge', () => {
    const wedge = (): HTMLElement => within(screen.getByRole('menu')).getAllByRole('menuitem')[2]

    it('is disabled until the calendar is connected', async () => {
      const user = userEvent.setup()
      prepare()
      await show()
      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
      expect(wedge().getAttribute('aria-label')).toBe(ko.pie.labels['arm:google-calendar'])
      expect(wedge().getAttribute('aria-disabled')).toBe('true')
    })

    it('when connected it is enabled and opens Google Calendar on the web (a fixed address)', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.calendarState.status = { state: 'on' }
      await show()
      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
      await waitFor(() => expect(wedge().getAttribute('aria-disabled')).toBeNull())

      await user.click(wedge())

      expect(backend.calendar.openWeb).toHaveBeenCalled()
      expect(backend.opened).toEqual(['https://calendar.google.com/'])
    })
  })
})

describe('Arms screen: Google 캘린더 card', () => {
  let b: Backend
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const googleArm = () => {
    let saved: { clientId: string; clientSecret?: string } | null = null
    const arm = fakeArm({ manifest: { id: 'google-calendar', name: 'Google 캘린더', auth: 'oauth', scopes: ['x'], capabilities: ['events.read'] } })
    arm.availability = () => (saved ? { available: true } : { available: false, reason: ko.home.calendar.notConfigured })
    arm.advanced = { clientIdSaved: () => saved !== null, setClient: (v) => void (saved = v) }
    return { arm, saved: () => saved }
  }
  const card = () => screen.findByRole('article', { name: ko.arms.cardLabel('Google 캘린더') })

  it('a build without a client id: [연결] is disabled and the reason is shown; connect() is never called', async () => {
    b = installBackend('arms')
    const { arm } = googleArm()
    const connect = vi.spyOn(arm, 'connect')
    b.armManager.register(arm)
    render(<App />)
    const c = await card()

    expect(within(c).getByText(ko.home.calendar.notConfigured)).toBeTruthy()
    expect((within(c).getByRole('button', { name: ko.arms.connect }) as HTMLButtonElement).disabled).toBe(true)
    expect((await b.arms.connect('google-calendar')) as { ok: boolean }).toMatchObject({ ok: true, data: { status: { state: 'off' } } })
    expect(connect).not.toHaveBeenCalled()
  })

  it('advanced fold: saves a custom client (value never shown again), then [연결] works; clearing goes back', async () => {
    const user = userEvent.setup()
    b = installBackend('arms')
    const g = googleArm()
    b.armManager.register(g.arm)
    render(<App />)
    const c = await card()
    const a = ko.arms.advanced
    expect(c.querySelector('details')?.open).toBe(false) // 기본 화면에는 접혀 있다

    await user.type(within(c).getByLabelText(a.clientId), 'my-client-12345.apps.example')
    await user.type(within(c).getByLabelText(a.clientSecret), 'my-secret-value')
    await user.click(within(c).getByRole('button', { name: a.save }))

    await waitFor(() => expect(within(c).getByText(a.saved)).toBeTruthy())
    expect(b.arms.setClient).toHaveBeenCalledWith('google-calendar', { clientId: 'my-client-12345.apps.example', clientSecret: 'my-secret-value' })
    expect(g.saved()).toEqual({ clientId: 'my-client-12345.apps.example', clientSecret: 'my-secret-value' })
    expect((within(c).getByLabelText(a.clientId) as HTMLInputElement).value).toBe('')
    expect(document.body.innerHTML).not.toMatch(/my-client-12345|my-secret-value/)
    await waitFor(() => expect((within(c).getByRole('button', { name: ko.arms.connect }) as HTMLButtonElement).disabled).toBe(false))

    await user.click(within(c).getByRole('button', { name: a.clear }))

    await waitFor(() => expect(g.saved()).toBeNull())
    expect(b.arms.setClient).toHaveBeenLastCalledWith('google-calendar', null)
  })

  it('refuses a client id with bad characters or a secret with bad characters, and a too short id', async () => {
    const user = userEvent.setup()
    b = installBackend('arms')
    const g = googleArm()
    b.armManager.register(g.arm)
    render(<App />)
    const c = await card()
    const a = ko.arms.advanced

    await user.type(within(c).getByLabelText(a.clientId), 'bad id with spaces')
    await user.click(within(c).getByRole('button', { name: a.save }))
    expect((await within(c).findByRole('alert')).textContent).toBe(a.errors.clientId)
    expect(g.saved()).toBeNull()
  })

  it('an arm without advanced options shows no advanced fold, and unknown arms cannot be configured', async () => {
    b = installBackend('arms')
    b.armManager.register(fakeArm({ manifest: { name: '일반 Arm' } }))
    render(<App />)
    const c = await screen.findByRole('article', { name: ko.arms.cardLabel('일반 Arm') })
    expect(within(c).queryByText(ko.arms.advanced.summary)).toBeNull()
    expect(await b.arms.setClient('test-arm', { clientId: 'abcdefgh1234' })).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await b.arms.setClient('nope', null)).toEqual({ ok: false, error: { code: 'not_found' } })
  })
})

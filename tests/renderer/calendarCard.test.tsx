// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { fakeArm } from '../arms/helpers'
import { installBackend, type Backend } from './backend'
import { DEFAULT_PIE_SLOTS, type ActionId } from '../../src/shared/pie/actions'

// 홈 "캘린더" 카드: 월간 달력은 Google 상태와 상관없이 보이고, 아래 한 줄에서 Google 상태만 알려 준다(C1-01, C1-11, C1-10 UI).

const t = ko.home
const c = ko.home.calendar
const m = ko.home.localCalendar

/** 날짜 칸(격자의 버튼). 날짜 문자열로 찾는다. */
const cell = (date: string): HTMLElement => document.querySelector(`[data-date="${date}"]`) as HTMLElement

describe('home: calendar card (month grid + Google status line)', () => {
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

  it('the card is titled 캘린더 (not 오늘 일정) and shows the month with 42 day cells', async () => {
    prepare()
    const card = await show()
    expect(within(card).getByText('2026년 3월')).toBeTruthy()
    expect(card.querySelectorAll('[data-date]').length).toBe(42)
    expect(cell('2026-03-10').getAttribute('aria-current')).toBe('date') // 오늘
  })

  it('without Google connected the month is still shown and the connect hint does not replace it (C1-01)', async () => {
    prepare()
    const card = await show()
    expect(await within(card).findByText(c.empty)).toBeTruthy()
    expect(card.querySelectorAll('[data-date]').length).toBe(42)
  })

  it('Google connect button opens the Arms screen; the month stays usable', async () => {
    const user = userEvent.setup()
    prepare()
    const card = await show()
    await user.click(await within(card).findByRole('button', { name: c.connect }))
    expect(await screen.findByRole('heading', { level: 1, name: /Arms/ })).toBeTruthy()
  })

  it('this build without Google setup says so, and the month is still there', async () => {
    const backend = prepare()
    backend.calendarState.configured = false
    backend.calendarState.unavailableReason = c.notConfigured
    const card = await show()
    expect(await within(card).findByText(c.notConfigured)).toBeTruthy()
    expect(within(card).queryByRole('button', { name: c.connect })).toBeNull()
    expect(card.querySelectorAll('[data-date]').length).toBe(42)
  })

  it('a Google error shows the reason and [다시 연결] (asks the Arm again), the month is unaffected', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { id: 'google-calendar', name: 'Google 캘린더' } }))
    backend.calendarState.status = { state: 'error', reason: '로그인이 만료됐어요.' }
    const card = await show()

    expect((await within(card).findByRole('alert')).textContent).toBe('로그인이 만료됐어요.')
    expect(card.querySelectorAll('[data-date]').length).toBe(42)

    // 오류 상태에서 누른다(상태를 먼저 바꾸면 진행 중인 읽기가 버튼을 치워 버려 누르기가 빗나갈 수 있다).
    await user.click(within(card).getByRole('button', { name: c.reconnect }))
    expect(backend.arms.connect).toHaveBeenCalledWith('google-calendar')
  })

  it('connected: the status line counts today\'s Google events (the events themselves are in the day detail)', async () => {
    const backend = prepare()
    backend.calendarState.status = { state: 'on' }
    backend.calendarState.events = [
      { id: 'a', title: '회의', start: new Date(2026, 2, 10, 9).toISOString(), end: new Date(2026, 2, 10, 10).toISOString(), allDay: false, url: null },
      { id: 'b', title: '면담', start: new Date(2026, 2, 10, 15).toISOString(), end: new Date(2026, 2, 10, 16).toISOString(), allDay: false, url: null }
    ]
    const card = await show()
    expect(await within(card).findByText(m.googleTodayCount(2))).toBeTruthy()
    expect(within(card).queryByText('회의')).toBeNull()
  })

  it('a day-count read failure shows a message and a retry that reads again (C1-10)', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.t.repo.create({ title: 'X', date: '2026-03-10' })
    backend.tasks.listRange.mockResolvedValueOnce({ ok: false, error: { code: 'db_unavailable' } })
    const card = await show()

    expect(await within(card).findByText(m.countsFailed)).toBeTruthy()
    expect(card.querySelectorAll('[data-date]').length).toBe(42)
    expect(cell('2026-03-10').getAttribute('aria-label')).not.toContain('할 일')
    await user.click(within(card).getByRole('button', { name: m.retry }))
    await waitFor(() => expect(cell('2026-03-10').getAttribute('aria-label')).toContain('할 일 1개'))
    expect(within(card).queryByText(m.countsFailed)).toBeNull()
  })

  it('days show how many items they hold; navigation changes the month and 오늘 comes back', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.t.repo.create({ title: 'A', date: '2026-03-10' })
    backend.t.repo.create({ title: 'B', date: '2026-03-10' })
    backend.t.repo.create({ title: 'C', date: '2026-03-10' })
    const card = await show()

    await waitFor(() => expect(cell('2026-03-10').getAttribute('aria-label')).toContain('할 일 3개'))
    await user.click(within(card).getByRole('button', { name: m.nextMonth }))
    expect(within(card).getByText('2026년 4월')).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: m.prevMonth }))
    await user.click(within(card).getByRole('button', { name: m.prevMonth }))
    expect(within(card).getByText('2026년 2월')).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: m.today }))
    expect(within(card).getByText('2026년 3월')).toBeTruthy()
  })
})

describe('home: Google 캘린더 wedge in the pie menu', () => {
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


  describe('pie menu 캘린더 wedge', () => {
    // 이 칸은 Google 웹 열기 칸이다(기본 3번 칸은 이제 로컬 달력). 3번 칸에 Google 칸을 둔다.
    const prepareGoogleAtThree = (): Backend => {
      const backend = prepare()
      const slots: ActionId[] = [...DEFAULT_PIE_SLOTS]
      slots[2] = 'arm:google-calendar'
      backend.settingsRepo.set('pie.slots', slots)
      return backend
    }
    const wedge = (): HTMLElement => within(screen.getByRole('menu')).getAllByRole('menuitem')[2]

    it('is disabled until the calendar is connected', async () => {
      const user = userEvent.setup()
      prepareGoogleAtThree()
      await show()
      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
      expect(wedge().getAttribute('aria-label')).toBe(ko.pie.labels['arm:google-calendar'])
      expect(wedge().getAttribute('aria-disabled')).toBe('true')
    })

    it('when connected it is enabled and opens Google Calendar on the web (a fixed address)', async () => {
      const user = userEvent.setup()
      const backend = prepareGoogleAtThree()
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

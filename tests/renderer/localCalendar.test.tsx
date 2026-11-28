// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import type { CalendarEvent } from '../../src/shared/calendar/types'
import { DEFAULT_PIE_SLOTS, type ActionId } from '../../src/shared/pie/actions'
import { fakeArm } from '../arms/helpers'
import { installBackend, type Backend } from './backend'

// C1 로컬 달력: 날짜 상세(큰 창)의 내용, 닫기·포커스·키보드, 날짜 이동, 늦은 응답, 실패, Google 격리, 원형 메뉴 접근.
// 기준 "지금" 은 2026-03-10(화) 12:00 로컬. 샘플 데이터는 C1 인수 기준 A~I 를 축소한 것이다.

const t = ko.home
const c = ko.home.calendar
const m = ko.home.localCalendar
const T = '2026-03-10'

const cell = (date: string): HTMLElement => document.querySelector(`[data-date="${date}"]`) as HTMLElement
const at = (h: number, min = 0): string => new Date(2026, 2, 10, h, min).toISOString()
const event = (over: Partial<CalendarEvent> & { id: string; title: string }): CalendarEvent => ({
  start: at(9),
  end: at(10),
  allDay: false,
  url: 'https://calendar.example.com/e/' + over.id,
  ...over
})

describe('local calendar: day detail', () => {
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

  /** C1 샘플: A 09:00 / B 시간 없음 / I 반복 / C 내일 14:00 / D 지난 미완료 / E 어제 예정·오늘 완료 / F 수신함 / G 나중 / H 취소 */
  function seed(backend: Backend): void {
    const repo = backend.t.repo
    repo.create({ title: 'A 아침', date: T, time: '09:00' })
    repo.create({ title: 'B 시간없음', date: T })
    repo.create({ title: 'I 반복', date: T, repeat: { freq: 'daily', interval: 1 } })
    repo.create({ title: 'C 내일', date: '2026-03-11', time: '14:00' })
    repo.create({ title: 'D 지난', date: '2026-03-09' })
    const e = repo.create({ title: 'E 어제 한 일', date: '2026-03-09' })
    repo.setStatus(e.id, 'done') // 완료 시각은 오늘이지만 예정 날짜는 어제
    repo.create({ title: 'F 수신함' })
    repo.create({ title: 'G 나중', bucket: 'someday' })
    const h = repo.create({ title: 'H 취소', date: T })
    repo.setStatus(h.id, 'canceled')
  }

  const prepare = (): Backend => (b = installBackend('home'))
  async function show(backend?: Backend): Promise<HTMLElement> {
    if (backend) seed(backend)
    render(<App />)
    const card = await screen.findByRole('region', { name: t.cards.calendar })
    await waitFor(() => expect(cell(T)).toBeTruthy())
    return card
  }
  const dialogNamed = (title: string): Promise<HTMLElement> => screen.findByRole('dialog', { name: title })
  const dialogNow = (): HTMLElement | null => screen.queryByRole('dialog')
  /** 상세 안의 할 일 줄(텍스트) 순서 */
  const rows = (dialog: HTMLElement): string[] => within(dialog).queryAllByRole('listitem').map((li) => li.textContent ?? '')
  const taskCount = (): number => (b.t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n

  it('C1-02: the 10th opens a large detail with A, B and I only (not other days, not inbox, someday or cancelled)', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const card = await show(backend)
    await user.click(cell(T))

    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const text = dialog.textContent ?? ''
    expect(text).toContain('A 아침')
    expect(text).toContain('B 시간없음')
    expect(text).toContain('I 반복')
    for (const other of ['C 내일', 'D 지난', 'E 어제 한 일', 'F 수신함', 'G 나중', 'H 취소']) expect(text).not.toContain(other)
    expect(within(card).getByText('2026년 3월')).toBeTruthy()
  })

  it('C1-02: timed items come first in time order; untimed items are listed separately after them', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.t.repo.create({ title: 'A 오후', date: T, time: '15:00' })
    await show(backend)
    await user.click(cell(T))
    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')

    const titles = rows(dialog).map((text) => ['A 아침', 'A 오후', 'B 시간없음', 'I 반복'].find((title) => text.includes(title)))
    expect(titles).toEqual(['A 아침', 'A 오후', 'B 시간없음', 'I 반복'])
    expect(within(dialog).getByRole('list', { name: m.timedHeading }).textContent).toContain('A 아침')
    expect(within(dialog).getByRole('list', { name: m.untimedHeading }).textContent).toContain('B 시간없음')
  })

  it('C1-03: yesterday shows D (open, overdue) and E (completed); E does not move to today because it was finished today', async () => {
    const user = userEvent.setup()
    await show(prepare())
    await user.click(cell('2026-03-09'))

    const dialog = await dialogNamed('2026년 3월 9일 (월)')
    expect(dialog.textContent).toContain('D 지난')
    expect(dialog.textContent).toContain(m.overdue)
    const e = rows(dialog).find((text) => text.includes('E 어제 한 일'))
    expect(e).toBeTruthy()
    // 완료는 줄긋기와 체크로만 보인다(따로 '완료' 글자를 붙이지 않는다)
    expect(e).not.toContain(m.done)
    expect(dialog.textContent).not.toContain('A 아침')
  })

  it('C1-04: Esc closes, keeps the month and the home layout, and returns focus to the day that was opened', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const card = await show(backend)
    await user.click(cell(T))
    await dialogNamed('2026년 3월 10일 (화) · 오늘')

    await user.keyboard('{Escape}')

    expect(dialogNow()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(cell(T)))
    expect(within(card).getByText('2026년 3월')).toBeTruthy()
    expect(backend.settings.set.mock.calls.filter(([key]) => key === 'home.layout')).toEqual([])
  })

  it('C1-04: the close button closes the detail the same way', async () => {
    const user = userEvent.setup()
    await show(prepare())
    await user.click(cell(T))
    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    await user.click(within(dialog).getByRole('button', { name: ko.home.dialogs.close }))
    expect(dialogNow()).toBeNull()
  })

  it('C1-05: 다음 날 / 이전 날 move the detail and show that day\'s own items', async () => {
    const user = userEvent.setup()
    await show(prepare())
    await user.click(cell(T))
    let dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')

    await user.click(within(dialog).getByRole('button', { name: m.nextDay }))
    dialog = await dialogNamed('2026년 3월 11일 (수)')
    await waitFor(() => expect(dialog.textContent).toContain('C 내일'))
    expect(dialog.textContent).not.toContain('A 아침')

    await user.click(within(dialog).getByRole('button', { name: m.prevDay }))
    await user.click(within(dialog).getByRole('button', { name: m.prevDay }))
    dialog = await dialogNamed('2026년 3월 9일 (월)')
    await waitFor(() => expect(dialog.textContent).toContain('D 지난'))

    // '오늘' 버튼은 없앴다(화살표로 충분하다)
    expect(within(dialog).queryByRole('button', { name: m.today })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: m.nextDay }))
    dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    await waitFor(() => expect(dialog.textContent).toContain('A 아침'))
  })

  it('C1-06: month navigation crosses the year end; the detail of 1 Jan 2027 has no 오늘 label', async () => {
    const user = userEvent.setup()
    const card = await show(prepare())
    for (let i = 0; i < 9; i++) await user.click(within(card).getByRole('button', { name: m.nextMonth }))
    expect(within(card).getByText('2026년 12월')).toBeTruthy()
    expect(cell('2026-11-29')).toBeTruthy()

    await user.click(within(card).getByRole('button', { name: m.nextMonth }))
    expect(within(card).getByText('2027년 1월')).toBeTruthy()
    expect(cell('2027-01-01')).toBeTruthy()

    await user.click(cell('2027-01-01'))
    const dialog = await dialogNamed('2027년 1월 1일 (금)')
    await user.click(within(dialog).getByRole('button', { name: m.prevDay }))
    await dialogNamed('2026년 12월 31일 (목)')
  })

  it('C1-07: an empty day says there is nothing on it, without an error or a loading message that never ends', async () => {
    const user = userEvent.setup()
    await show(prepare())
    await user.click(cell('2026-03-20'))
    const dialog = await dialogNamed('2026년 3월 20일 (금)')
    expect(await within(dialog).findByText(m.emptyDay)).toBeTruthy()
    expect(within(dialog).queryByText(m.loading)).toBeNull()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('C1-08: a late answer for the previous day never replaces the day that is shown now', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    seed(backend)
    const waiting: { from: string; to: string; resolve: (r: unknown) => void }[] = []
    backend.tasks.listRange.mockImplementation((from: unknown, to: unknown) => new Promise((resolve) => waiting.push({ from: from as string, to: to as string, resolve: resolve as (r: unknown) => void })))
    render(<App />)
    await screen.findByRole('region', { name: t.cards.calendar })

    const answer = async (from: string, to: string): Promise<void> => {
      const entry = waiting.find((w) => w.from === from && w.to === to)
      if (!entry) throw new Error(`no pending request for ${from}..${to}`)
      await act(async () => entry.resolve({ ok: true, data: backend.t.repo.listRange(from, to) }))
    }

    await user.click(cell(T)) // 10일 요청(대기)
    await waitFor(() => expect(waiting.some((w) => w.from === T && w.to === T)).toBe(true))
    let dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    await user.click(within(dialog).getByRole('button', { name: m.nextDay })) // 11일 요청(대기)
    dialog = await dialogNamed('2026년 3월 11일 (수)')
    await waitFor(() => expect(waiting.some((w) => w.from === '2026-03-11')).toBe(true))

    await answer('2026-03-11', '2026-03-11') // 늦게 온 것보다 먼저 11일이 도착
    await waitFor(() => expect(dialog.textContent).toContain('C 내일'))
    await answer(T, T) // 10일 응답이 뒤늦게 도착
    expect(dialog.textContent).toContain('C 내일')
    expect(dialog.textContent).not.toContain('A 아침')
    expect(dialog.textContent).toContain('2026년 3월 11일')
  })

  it('C1-09: closing while the day is still loading does not bring the detail back when the answer arrives', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    seed(backend)
    const waiting: { from: string; resolve: (r: unknown) => void }[] = []
    backend.tasks.listRange.mockImplementation((from: unknown) => new Promise((resolve) => waiting.push({ from: from as string, resolve: resolve as (r: unknown) => void })))
    render(<App />)
    await screen.findByRole('region', { name: t.cards.calendar })

    await user.click(cell(T))
    await dialogNamed('2026년 3월 10일 (화) · 오늘')
    await user.keyboard('{Escape}')
    expect(dialogNow()).toBeNull()

    await act(async () => waiting.filter((w) => w.from === T).forEach((w) => w.resolve({ ok: true, data: backend.t.repo.listRange(T, T) })))
    expect(dialogNow()).toBeNull()
  })

  it('C1-10: when the day cannot be read the detail says so and 다시 시도 reads it again', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    seed(backend)
    await show()
    backend.tasks.listRange.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })

    await user.click(cell(T))
    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    expect(await within(dialog).findByText(m.loadFailed)).toBeTruthy()
    expect(within(dialog).queryByText('A 아침')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: m.retry }))
    await waitFor(() => expect(within(dialog).getByText('A 아침')).toBeTruthy())
  })

  it('C1-11: a Google error on today is shown inside the Google section and does not hide the local items', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { id: 'google-calendar', name: 'Google 캘린더' } }))
    backend.calendarState.status = { state: 'error', reason: '로그인이 만료됐어요.' }
    await show(backend)
    await user.click(cell(T))

    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    const google = within(dialog).getByRole('region', { name: m.googleSection })
    expect(within(google).getByRole('alert').textContent).toBe('로그인이 만료됐어요.')
    expect(within(google).getByRole('button', { name: c.reconnect })).toBeTruthy()
    expect(dialog.textContent).toContain('A 아침')
  })

  it('C1-11: today\'s Google events are read-only rows in their own section; clicking one opens its stored https address', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.calendarState.status = { state: 'on' }
    backend.calendarState.events = [event({ id: 'abc', title: '회의' })]
    await show(backend)
    await user.click(cell(T))

    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')
    const google = within(dialog).getByRole('region', { name: m.googleSection })
    await user.click(within(google).getByRole('button', { name: c.eventLabel('회의') }))
    expect(backend.calendar.openEvent).toHaveBeenCalledWith('abc')
    expect(backend.opened).toEqual(['https://calendar.example.com/e/abc'])
  })

  it('C1-12: on another day the Google section never shows today\'s events (and no "only today" explanation either)', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.calendarState.status = { state: 'on' }
    backend.calendarState.events = [event({ id: 'abc', title: '오늘 회의' })]
    await show(backend)
    await user.click(cell('2026-03-11'))

    const dialog = await dialogNamed('2026년 3월 11일 (수)')
    expect(within(dialog).queryByRole('region', { name: m.googleSection })).toBeNull()
    expect(dialog.textContent).not.toContain('오늘 회의')
  })

  it('C1-12: without Google connected a day other than today shows no Google section at all', async () => {
    const user = userEvent.setup()
    await show(prepare())
    await user.click(cell('2026-03-11'))
    const dialog = await dialogNamed('2026년 3월 11일 (수)')
    expect(within(dialog).queryByRole('region', { name: m.googleSection })).toBeNull()
  })

  it('C1-14: a day can be opened from the keyboard, Tab stays inside the detail, and Esc closes it', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    await show(backend)
    cell(T).focus()
    await user.keyboard('{Enter}')
    const dialog = await dialogNamed('2026년 3월 10일 (화) · 오늘')

    for (let i = 0; i < 25; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 25; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }

    within(dialog).getByRole('button', { name: ko.home.dialogs.close }).focus()
    await user.keyboard('{Enter}')
    expect(dialogNow()).toBeNull()
  })

  it('C1-13: browsing months and opening days never creates, changes or deletes a task', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const card = await show(backend)
    const before = taskCount()

    await user.click(within(card).getByRole('button', { name: m.nextMonth }))
    await user.click(cell('2026-04-02'))
    await dialogNamed('2026년 4월 2일 (목)')
    await user.keyboard('{Escape}')
    await user.click(cell(T))
    await user.keyboard('{Escape}')

    expect(taskCount()).toBe(before)
  })
})

describe('local calendar: pie menu access (C1-15)', () => {
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

  it('a wedge set to 로컬 달력 opens today\'s detail without a Google connection; the saved wedges are kept as they are', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    const slots: ActionId[] = [...DEFAULT_PIE_SLOTS]
    slots[2] = 'calendar:local'
    b.settingsRepo.set('pie.slots', slots)

    render(<App />)
    const circle = await screen.findByRole('button', { name: ko.pie.menuLabel })
    await user.click(circle)
    await user.click(screen.getByRole('menuitem', { name: '달력' }))

    expect(await screen.findByRole('dialog', { name: '2026년 3월 10일 (화) · 오늘' })).toBeTruthy()
    expect(b.settingsRepo.get('pie.slots')).toEqual(slots)
  })
})

describe('local calendar: Google events in the day detail', () => {
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

  /** 오늘 상세를 연다. Google 일정 영역을 돌려준다. */
  async function openTodayGoogle(backend: Backend): Promise<HTMLElement> {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('region', { name: t.cards.calendar })
    await waitFor(() => expect(cell(T)).toBeTruthy())
    await user.click(cell(T))
    const dialog = await screen.findByRole('dialog', { name: '2026년 3월 10일 (화) · 오늘' })
    return within(dialog).getByRole('region', { name: m.googleSection })
  }

  it('past events are dimmed, the one in progress is highlighted with a badge, later ones are normal', async () => {
    b = installBackend('home')
    b.calendarState.status = { state: 'on' }
    b.calendarState.events = [
      event({ id: 'past', title: '지난 일정', start: at(9), end: at(10) }),
      event({ id: 'now', title: '진행 중 일정', start: at(11, 30), end: at(12, 30) }),
      event({ id: 'later', title: '나중 일정', start: at(15), end: at(16) })
    ]
    const google = await openTodayGoogle(b)

    const rows = within(google).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-phase'))).toEqual(['past', 'now', 'later'])
    expect(rows[1].getAttribute('aria-current')).toBe('time')
    expect(within(rows[1]).getByText(c.now)).toBeTruthy()
    expect(within(rows[0]).queryByText(c.now)).toBeNull()
    expect(rows[0].querySelector('button')?.className ?? rows[0].firstElementChild?.className).toContain('text-[#8a8983]')
  })

  it('an event with no link is plain text (not a button); an unsafe address is never opened by main', async () => {
    b = installBackend('home')
    b.calendarState.status = { state: 'on' }
    b.calendarState.events = [event({ id: 'x', title: '링크 없음', url: null })]
    const google = await openTodayGoogle(b)
    await within(google).findByText('링크 없음')
    expect(within(google).queryByRole('button', { name: c.eventLabel('링크 없음') })).toBeNull()

    b.calendarState.events = [event({ id: 'y', title: '위험', url: 'http://plain.example.com/' })]
    expect(await b.calendar.openEvent('y')).toMatchObject({ ok: false })
    expect(await b.calendar.openEvent('../etc')).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(b.opened).toEqual([])
  })

  it('titles are plain text — no HTML, no scripts', async () => {
    b = installBackend('home')
    b.calendarState.status = { state: 'on' }
    const evil = '<img src=x onerror="window.__pwned=1"><b>굵게</b>'
    b.calendarState.events = [event({ id: 'e', title: evil })]
    const google = await openTodayGoogle(b)

    await within(google).findByText(evil)
    expect(google.querySelector('img, b, script')).toBeNull()
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
  })
})

describe('local calendar: today\'s Google list', () => {
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

  it('today\'s events are listed in the order main gives them, all-day ones show 종일; with nothing today it says so', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.calendarState.status = { state: 'on' }
    b.calendarState.events = [
      event({ id: 'a', title: '종일 행사', allDay: true, start: '2026-03-10', end: '2026-03-11' }),
      event({ id: 'b', title: '아침 회의', start: at(9), end: at(10) }),
      event({ id: 'c', title: '오후 면담', start: at(15), end: at(16) })
    ]
    render(<App />)
    await screen.findByRole('region', { name: t.cards.calendar })
    await waitFor(() => expect(cell(T)).toBeTruthy())
    await user.click(cell(T))
    const dialog = await screen.findByRole('dialog', { name: '2026년 3월 10일 (화) · 오늘' })
    const google = within(dialog).getByRole('region', { name: m.googleSection })

    const rows = within(google).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([`${c.allDay}종일 행사`, '09:00~10:00아침 회의', '15:00~16:00오후 면담'])
  })

  it('connected with nothing today: the Google section says there are no events', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.calendarState.status = { state: 'on' }
    render(<App />)
    await screen.findByRole('region', { name: t.cards.calendar })
    await waitFor(() => expect(cell(T)).toBeTruthy())
    await user.click(cell(T))
    const dialog = await screen.findByRole('dialog', { name: '2026년 3월 10일 (화) · 오늘' })
    expect(within(dialog).getByRole('region', { name: m.googleSection }).textContent).toContain(c.noEvents)
  })
})

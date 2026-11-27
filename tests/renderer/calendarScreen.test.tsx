// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// ATDT 의 달력 탭과 같은 구성: 왼쪽 큰 월간 달력, 오른쪽 고른 날짜의 할 일(추가·완료·편집).
const m = ko.home.localCalendar
const T = '2026-11-26'

describe('calendar screen', () => {
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

  const menu = (): HTMLElement => screen.getByRole('navigation', { name: ko.nav.label })
  const grid = (): HTMLElement => screen.getByRole('region', { name: ko.calendarScreen.title })
  const cell = (date: string): HTMLElement => grid().querySelector(`[data-date="${date}"]`) as HTMLElement
  const panel = (title: string): Promise<HTMLElement> => screen.findByRole('region', { name: title })

  async function open(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(within(menu()).getByRole('button', { name: ko.nav.calendar }))
    await screen.findByRole('heading', { level: 1, name: ko.calendarScreen.title })
    return user
  }

  it('is in the left menu right after 할 일, and opens on today with the day panel beside the month', async () => {
    b = installBackend('home')
    b.t.repo.create({ title: '오늘 보고서', date: T })
    await open()

    const labels = within(menu()).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(labels.indexOf(ko.nav.calendar)).toBe(labels.indexOf(ko.nav.tasks) + 1)
    expect(within(menu()).getByRole('button', { name: ko.nav.calendar }).getAttribute('aria-current')).toBe('page')

    expect(within(grid()).getByText('2026년 11월')).toBeTruthy()
    expect(cell(T).getAttribute('aria-current')).toBe('date')
    expect(cell(T).getAttribute('aria-pressed')).toBe('true')
    const day = await panel('2026년 11월 26일 (목) · 오늘')
    expect(await within(day).findByText('오늘 보고서')).toBeTruthy()
  })

  it('shows ATDT-style marks: ● all done, ◐ some done, ○ none done, with the count', async () => {
    b = installBackend('home')
    const all = b.t.repo.create({ title: '다 함', date: '2026-11-10' })
    b.t.repo.setStatus(all.id, 'done')
    const some = b.t.repo.create({ title: '일부 1', date: '2026-11-11' })
    b.t.repo.create({ title: '일부 2', date: '2026-11-11' })
    b.t.repo.setStatus(some.id, 'done')
    b.t.repo.create({ title: '못 함', date: '2026-11-12' })
    await open()

    await waitFor(() => expect(cell('2026-11-10').textContent).toContain('●'))
    expect(cell('2026-11-11').textContent).toContain('◐')
    expect(cell('2026-11-11').textContent).toContain('2')
    expect(cell('2026-11-12').textContent).toContain('○')
    expect(cell('2026-11-11').getAttribute('aria-label')).toContain(m.dayCount(2, 1))
    expect(within(grid()).getByText(ko.calendarScreen.monthDone(2, 4))).toBeTruthy()
  })

  it('clicking a day moves the panel; adding there updates the month without losing the selection', async () => {
    b = installBackend('home')
    const user = await open()
    await user.click(cell('2026-11-28'))
    const day = await panel('2026년 11월 28일 (토)')
    expect(cell('2026-11-28').getAttribute('aria-pressed')).toBe('true')

    await user.type(within(day).getByLabelText(m.addLabel), '토요일 장보기{Enter}')
    await waitFor(() => expect(cell('2026-11-28').getAttribute('aria-label')).toContain(m.dayCount(1, 0)))
    expect(b.t.repo.listRange('2026-11-28', '2026-11-28').map((task) => task.title)).toEqual(['토요일 장보기'])
    expect(cell('2026-11-28').getAttribute('aria-pressed')).toBe('true')
    expect(within(await panel('2026년 11월 28일 (토)')).getByText('토요일 장보기')).toBeTruthy()
  })

  it('with a draft typed, clicking another day asks first and keeps the draft when you keep writing', async () => {
    b = installBackend('home')
    const user = await open()
    const day = await panel('2026년 11월 26일 (목) · 오늘')
    await user.type(within(day).getByLabelText(m.addLabel), '쓰는 중')
    await user.click(cell('2026-11-27'))

    expect(within(day).getByText(m.discardTitle)).toBeTruthy()
    await user.click(within(day).getByRole('button', { name: m.discardNo }))
    expect((within(day).getByLabelText(m.addLabel) as HTMLInputElement).value).toBe('쓰는 중')
    expect(cell(T).getAttribute('aria-pressed')).toBe('true')
  })

  it('the panel arrows cross into the next month and the grid follows; 오늘 comes back', async () => {
    b = installBackend('home')
    const user = await open()
    await user.click(cell('2026-11-30'))
    const day = await panel('2026년 11월 30일 (월)')
    await user.click(within(day).getByRole('button', { name: m.nextDay }))
    await panel('2026년 12월 1일 (화)')
    expect(within(grid()).getByText('2026년 12월')).toBeTruthy()

    await user.click(within(grid()).getByRole('button', { name: m.today }))
    await panel('2026년 11월 26일 (목) · 오늘')
    expect(within(grid()).getByText('2026년 11월')).toBeTruthy()
  })

  it('while viewing another month with a draft, 오늘 → [계속 쓰기] keeps the month, the selected day and the draft', async () => {
    b = installBackend('home')
    const user = await open()
    await user.click(cell('2026-11-30'))
    await panel('2026년 11월 30일 (월)')
    await user.click(within(grid()).getByRole('button', { name: m.nextMonth }))
    expect(within(grid()).getByText('2026년 12월')).toBeTruthy()

    const day = await panel('2026년 11월 30일 (월)')
    await user.type(within(day).getByLabelText(m.addLabel), '초안')
    await user.click(within(grid()).getByRole('button', { name: m.today }))

    expect(within(day).getByText(m.discardTitle)).toBeTruthy()
    await user.click(within(day).getByRole('button', { name: m.discardNo }))
    expect(within(grid()).getByText('2026년 12월')).toBeTruthy()
    expect(cell('2026-11-30').getAttribute('aria-pressed')).toBe('true')
    expect(within(day).getByRole('heading', { name: '2026년 11월 30일 (월)' })).toBeTruthy()
    expect((within(day).getByLabelText(m.addLabel) as HTMLInputElement).value).toBe('초안')
  })

  it('오늘 → [버리기] moves the panel to today and the month follows', async () => {
    b = installBackend('home')
    const user = await open()
    await user.click(cell('2026-11-30'))
    await panel('2026년 11월 30일 (월)')
    await user.click(within(grid()).getByRole('button', { name: m.nextMonth }))
    const day = await panel('2026년 11월 30일 (월)')
    await user.type(within(day).getByLabelText(m.addLabel), '초안')
    await user.click(within(grid()).getByRole('button', { name: m.today }))
    await user.click(within(day).getByRole('button', { name: m.discardYes }))

    await panel('2026년 11월 26일 (목) · 오늘')
    expect(within(grid()).getByText('2026년 11월')).toBeTruthy()
    expect(cell(T).getAttribute('aria-pressed')).toBe('true')
    expect((within(day).getByLabelText(m.addLabel) as HTMLInputElement).value).toBe('')
  })

  it('after paging with ‹ › while drafting, a cell click in that month asks first and [계속 쓰기] keeps everything', async () => {
    b = installBackend('home')
    const user = await open()
    const day = await panel('2026년 11월 26일 (목) · 오늘')
    await user.type(within(day).getByLabelText(m.addLabel), '쓰는 중')
    await user.click(within(grid()).getByRole('button', { name: m.prevMonth }))
    expect(within(grid()).getByText('2026년 10월')).toBeTruthy()

    await user.click(cell('2026-10-03'))
    expect(within(day).getByText(m.discardTitle)).toBeTruthy()
    await user.click(within(day).getByRole('button', { name: m.discardNo }))
    expect(within(grid()).getByText('2026년 10월')).toBeTruthy()
    expect(within(day).getByRole('heading', { name: '2026년 11월 26일 (목) · 오늘' })).toBeTruthy()
    expect(cell('2026-10-03').getAttribute('aria-pressed')).toBe('false')
    expect((within(day).getByLabelText(m.addLabel) as HTMLInputElement).value).toBe('쓰는 중')
  })

  it('the panel is part of the page, not a modal: no close button, no dialog role', async () => {
    b = installBackend('home')
    await open()
    const day = await panel('2026년 11월 26일 (목) · 오늘')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(day).queryByRole('button', { name: ko.home.dialogs.close })).toBeNull()
  })
})

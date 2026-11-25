// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { CalendarCard } from '../../src/renderer/home/cards/CalendarCard'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// C1 보완 후속 검사: 선택 표시가 상세 안의 날짜 이동을 따라가는지, 다시 읽기(포커스·자정)·실패 구분, 긴 제목, 정상 화면의 Ctrl+K.

const m = ko.home.localCalendar
const cell = (date: string): HTMLElement => document.querySelector(`[data-date="${date}"]`) as HTMLElement
const countOf = (date: string): string | null => cell(date).getAttribute('aria-label')

describe('C1 follow-up checks', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 24, 12))
    b = installBackend('home')
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  async function showHome(): Promise<HTMLElement> {
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.calendar })
    await waitFor(() => expect(cell('2026-11-24')).toBeTruthy())
    return card
  }

  it('the selection follows a move made inside the detail, and stays after closing', async () => {
    const user = userEvent.setup()
    await showHome()
    await user.click(cell('2026-11-25'))
    const dialog = await screen.findByRole('dialog', { name: /2026년 11월 25일/ })
    await user.click(within(dialog).getByRole('button', { name: m.nextDay }))
    await screen.findByRole('dialog', { name: /2026년 11월 26일/ })

    await user.keyboard('{Escape}')

    expect(cell('2026-11-26').getAttribute('aria-pressed')).toBe('true')
    expect(cell('2026-11-25').getAttribute('aria-pressed')).toBeNull()
    expect(cell('2026-11-26').getAttribute('aria-label')).toContain(m.selectedMark)
  })

  it('today and the selected day are both marked when they are the same day', async () => {
    const user = userEvent.setup()
    await showHome()
    await user.click(cell('2026-11-24'))
    await screen.findByRole('dialog', { name: /2026년 11월 24일/ })
    await user.keyboard('{Escape}')

    expect(cell('2026-11-24').getAttribute('aria-current')).toBe('date')
    expect(cell('2026-11-24').getAttribute('aria-pressed')).toBe('true')
  })

  it('a count added while the window was in the background shows up when the window gets focus again', async () => {
    await showHome()
    expect(countOf('2026-11-25')).not.toContain('할 일')

    b.t.repo.create({ title: '다른 창에서 추가', date: '2026-11-25' })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(countOf('2026-11-25')).toContain('할 일 1개'))
  })

  it('midnight: when today changes the counts are read again and today is marked on the new day', async () => {
    b.t.repo.create({ title: '내일 할 일', date: '2026-11-25' })
    const props = {
      calendar: null,
      refreshKey: 0,
      selectedDay: null,
      onOpenDay: () => undefined,
      onOpenArms: () => undefined,
      onReconnect: () => undefined
    }
    const view = render(<CalendarCard {...props} today="2026-11-24" />)
    await waitFor(() => expect(cell('2026-11-24')).toBeTruthy())
    expect(cell('2026-11-24').getAttribute('aria-current')).toBe('date')

    view.rerender(<CalendarCard {...props} today="2026-11-25" />)

    await waitFor(() => expect(cell('2026-11-25').getAttribute('aria-current')).toBe('date'))
    expect(cell('2026-11-24').getAttribute('aria-current')).toBeNull()
    await waitFor(() => expect(countOf('2026-11-25')).toContain('할 일 1개'))
  })

  it('a failed re-read is an error with retry, not the old result shown as success; retry recovers', async () => {
    const user = userEvent.setup()
    b.t.repo.create({ title: '유지되면 안 되는 값', date: '2026-11-25' })
    const card = await showHome()
    await waitFor(() => expect(countOf('2026-11-25')).toContain('할 일 1개'))

    b.tasks.listRange.mockResolvedValueOnce({ ok: false, error: { code: 'db_unavailable' } })
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(await within(card).findByText(m.countsFailed)).toBeTruthy()
    expect(countOf('2026-11-25')).not.toContain('할 일')

    await user.click(within(card).getByRole('button', { name: m.retry }))
    await waitFor(() => expect(countOf('2026-11-25')).toContain('할 일 1개'))
  })

  it('a long, unbroken title in the enlarged view is shown in full and wraps instead of being cut off', async () => {
    const user = userEvent.setup()
    const long = '아주긴제목'.repeat(30) + ' and a very-long-unbroken-token-' + 'x'.repeat(80)
    b.t.repo.create({ title: long, date: '2026-11-25' })
    await showHome()
    await user.click(cell('2026-11-25'))
    const dialog = await screen.findByRole('dialog', { name: /2026년 11월 25일/ })

    const title = within(dialog).getByText(long)
    expect(title.className).not.toContain('truncate')
    expect(title.className).toContain('overflow-wrap')
    expect(title.className).toContain('whitespace-normal')
    expect(title.closest('li')?.className).toContain('items-start')
  })

  it('Ctrl+K still opens the command window on a normal screen', async () => {
    const user = userEvent.setup()
    await showHome()
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: ko.command.title })).toBeTruthy()
  })
})

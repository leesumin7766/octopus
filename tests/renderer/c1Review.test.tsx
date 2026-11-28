// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

describe('C1 independent acceptance review', () => {
  let backend: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 24, 12))
    backend = installBackend('home')
  })

  afterEach(() => {
    cleanup()
    backend.t.db.close()
    vi.useRealTimers()
  })

  async function openDay() {
    const user = userEvent.setup()
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.calendar })
    const date = await within(card).findByRole('button', { name: /^2026년 11월 25일/ })
    await user.click(date)
    await screen.findByRole('dialog', { name: '2026년 11월 25일 (수)' })
    return { user, date }
  }

  it('retains a distinguishable selected date after closing the enlarged day', async () => {
    const { user, date } = await openDay()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(date)
    expect(date.getAttribute('aria-pressed')).toBe('true')
  })

  it('does not open a second modal over a day dialog through the global command shortcut', async () => {
    const { user } = await openDay()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('provides an enabled local calendar in the default pie menu without Google', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
    const calendar = screen.getByRole('menuitem', { name: /달력/ })
    expect(calendar.getAttribute('aria-disabled')).not.toBe('true')
    await user.click(calendar)
    expect(await screen.findByRole('dialog', { name: /2026년 11월 24일/ })).toBeTruthy()
    expect(backend.calendar.openWeb).not.toHaveBeenCalled()
  })
})

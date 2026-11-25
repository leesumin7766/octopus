// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { notifyDataChanged } from '../../src/renderer/dataEvents'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

describe('C2 independent acceptance: refresh preserves user work', () => {
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

  it('refreshes persisted data without losing a home memo draft or the browsed month', async () => {
    const user = userEvent.setup()
    render(<App />)
    const calendar = await screen.findByRole('region', { name: ko.home.cards.calendar })
    await user.click(within(calendar).getByRole('button', { name: ko.home.localCalendar.nextMonth }))
    await within(calendar).findByText('2026년 12월')
    const draft = await screen.findByRole('textbox', { name: ko.home.memo.quickLabel })
    await user.type(draft, '아직 저장하지 않은 메모')
    backend.memoRepo.create('외부 변경으로 추가된 메모')
    await act(async () => notifyDataChanged())
    expect((screen.getByRole('textbox', { name: ko.home.memo.quickLabel }) as HTMLInputElement).value).toBe('아직 저장하지 않은 메모')
    expect(within(calendar).getByText('2026년 12월')).toBeTruthy()
    await screen.findByText('외부 변경으로 추가된 메모')
  })

  it('refreshes an open day without closing it or changing the selected date', async () => {
    const user = userEvent.setup()
    render(<App />)
    const calendar = await screen.findByRole('region', { name: ko.home.cards.calendar })
    await user.click(await within(calendar).findByRole('button', { name: /^2026년 11월 25일/ }))
    await screen.findByRole('dialog', { name: /2026년 11월 25일/ })
    backend.t.repo.create({ title: '갱신 후에도 이 날짜', date: '2026-11-25' })
    await act(async () => notifyDataChanged())
    await waitFor(() => expect(screen.getByRole('dialog', { name: /2026년 11월 25일/ })).toBeTruthy())
    await within(screen.getByRole('dialog', { name: /2026년 11월 25일/ })).findByText('갱신 후에도 이 날짜')
  })
})

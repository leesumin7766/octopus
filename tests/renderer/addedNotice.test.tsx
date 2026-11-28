// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { ActionNotice, NOTICE_MS } from '../../src/renderer/ui/ActionNotice'
import { installBackend, type Backend } from './backend'

// F3: 추가한 할 일이 지금 보는 곳에 안 보이면 알려 주고, [보기] 로 그 보기에서 연다.
// 2026-11-25(수) 정오. 제목에 '일'·'월' 같은 한 글자 낱말을 혼자 쓰면 요일로 읽힌다.
const t = ko.tasks

describe('added-task notice and [보기]', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const homeCard = (): Promise<HTMLElement> => screen.findByRole('region', { name: ko.home.cards.todo })
  const detail = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: t.detail.title })
  const titleOf = (panel: HTMLElement): string => (within(panel).getByLabelText(t.detail.titleField) as HTMLInputElement).value
  const heading = (name: string): HTMLElement => screen.getByRole('heading', { level: 1, name })

  it('home: "보고서" goes to the inbox → notice → [보기] opens the inbox with it selected', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '보고서{Enter}')

    expect(await within(card).findByText(t.added.inbox)).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: t.added.view }))

    expect(await detail().then(titleOf)).toBe('보고서')
    expect(heading(t.views.inbox)).toBeTruthy()
  })

  it('home: "내일 보고서" → 예정 view with it selected', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '내일 보고서{Enter}')

    expect(await within(card).findByText(t.added.on('내일'))).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: t.added.view }))

    expect(await detail().then(titleOf)).toBe('보고서')
    expect(heading(t.views.upcoming)).toBeTruthy()
  })

  it('home: "오늘 보고서" and "3시 보고서" show in the card with no notice', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '오늘 보고서{Enter}')
    expect(await within(card).findByText('보고서')).toBeTruthy()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '3시 점검{Enter}')
    expect(await within(card).findByText('점검')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: t.added.view })).toBeNull()
  })

  it('home: writing something else in the input then pressing [보기] asks first', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    const input = within(card).getByLabelText(t.quickInputLabel) as HTMLInputElement
    await user.type(input, '보고서{Enter}')
    await within(card).findByText(t.added.inbox)
    await user.type(input, '쓰던 글')

    await user.click(within(card).getByRole('button', { name: t.added.view }))
    expect(screen.getByText(ko.home.localCalendar.discardTitle)).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()

    await user.click(screen.getByRole('button', { name: ko.home.localCalendar.discardYes }))
    expect(await detail().then(titleOf)).toBe('보고서')
  })

  it('tasks tab 오늘: "다음주 월 회의" → notice → [보기] switches to 예정 and selects it', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    render(<App />)
    const input = await screen.findByLabelText(t.quickInputLabel)
    await user.type(input, '다음주 월 회의{Enter}')

    expect(await screen.findByText(t.added.on('11/30 (월)'))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: t.added.view }))

    expect(await detail().then(titleOf)).toBe('회의')
    expect(heading(t.views.upcoming)).toBeTruthy()
  })

  it('tasks tab: adding to the view you are in gives no notice', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    render(<App />)
    await user.type(await screen.findByLabelText(t.quickInputLabel), '오늘 점검{Enter}')
    expect(await screen.findByText('점검')).toBeTruthy()
    expect(screen.queryByRole('button', { name: t.added.view })).toBeNull()
  })
})

describe('ActionNotice', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('is a status, runs its action, and expires after the notice time', () => {
    vi.useFakeTimers()
    const onAction = vi.fn()
    const onExpire = vi.fn()
    render(<ActionNotice message="알림" actionLabel="보기" onAction={onAction} onExpire={onExpire} />)

    expect(screen.getByRole('status').textContent).toContain('알림')
    act(() => void screen.getByRole('button', { name: '보기' }).click())
    expect(onAction).toHaveBeenCalledTimes(1)

    act(() => void vi.advanceTimersByTime(NOTICE_MS - 1))
    expect(onExpire).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { notifyDataChanged } from '../../src/renderer/dataEvents'
import { createLeaveGuardStore } from '../../src/renderer/leaveGuard'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

const n = ko.nav
const home = ko.home.localCalendar
const TODAY = '2026-03-10'

describe('leave guard store', () => {
  it('is dirty only while some registered place is dirty', () => {
    const store = createLeaveGuardStore()
    expect(store.isDirty()).toBe(false)

    store.set('a', true)
    store.set('b', true)
    expect(store.isDirty()).toBe(true)

    store.set('a', false)
    expect(store.isDirty()).toBe(true)

    store.remove('b')
    expect(store.isDirty()).toBe(false)
  })
})

describe('leaving a screen with unsaved input', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  const menu = (): HTMLElement => screen.getByRole('navigation', { name: n.label })
  const item = (label: string): HTMLElement => within(menu()).getByRole('button', { name: label })
  const strip = (): HTMLElement => screen.getByRole('group', { name: home.discardTitle })
  const memoInput = (): HTMLTextAreaElement => screen.getByLabelText(ko.memos.newLabel) as HTMLTextAreaElement
  const quickInput = (): HTMLInputElement => screen.getByLabelText(ko.tasks.quickInputLabel) as HTMLInputElement
  const panel = (): HTMLElement => screen.getByRole('complementary', { name: ko.tasks.detail.title })

  async function openTaskPanel(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
    await user.click(await screen.findByText(title))
    await screen.findByRole('complementary', { name: ko.tasks.detail.title })
  }

  it('moves at once when nothing unsaved is on the screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('navigation', { name: n.label })
    await user.click(item(n.memos))

    expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()
    expect(screen.queryByRole('group', { name: home.discardTitle })).toBeNull()
  })

  it('a memo draft asks before the left menu moves; keep writing stays, discard moves', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('navigation', { name: n.label })
    await user.click(item(n.memos))
    await user.type(await screen.findByLabelText(ko.memos.newLabel), '쓰던 메모')

    await user.click(item(n.tasks))
    expect(strip()).toBeTruthy()
    expect(memoInput().value).toBe('쓰던 메모')

    await user.click(within(strip()).getByRole('button', { name: home.discardNo }))
    expect(screen.queryByRole('group', { name: home.discardTitle })).toBeNull()
    expect(memoInput().value).toBe('쓰던 메모')

    await user.click(item(n.tasks))
    await user.click(within(strip()).getByRole('button', { name: home.discardYes }))
    expect(await screen.findByRole('heading', { level: 1, name: ko.tasks.views.today })).toBeTruthy()
    expect(screen.queryByLabelText(ko.memos.newLabel)).toBeNull()
  })

  it('an open task edit asks before the left menu moves', async () => {
    const user = userEvent.setup()
    b.t.repo.create({ title: '고치던 일', date: TODAY })
    render(<App />)
    await screen.findByRole('navigation', { name: n.label })
    await user.click(item(n.tasks))
    await openTaskPanel(user, '고치던 일')
    await user.type(within(panel()).getByLabelText(ko.tasks.detail.titleField), ' 수정')

    await user.click(item(n.memos))
    expect(strip()).toBeTruthy()
    expect(screen.queryByLabelText(ko.memos.newLabel)).toBeNull()

    await user.click(within(strip()).getByRole('button', { name: home.discardYes }))
    expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()
    expect(b.tasks.update).not.toHaveBeenCalled()
  })

  it('text in the task quick input asks before the left menu moves', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('navigation', { name: n.label })
    await user.click(item(n.tasks))
    await user.type(await screen.findByLabelText(ko.tasks.quickInputLabel), '쓰던 할 일')

    await user.click(item(n.home))
    expect(strip()).toBeTruthy()
    expect(quickInput().value).toBe('쓰던 할 일')

    await user.click(within(strip()).getByRole('button', { name: home.discardNo }))
    expect(quickInput().value).toBe('쓰던 할 일')
  })

  it('a data change keeps the memo draft and the task edit', async () => {
    const user = userEvent.setup()
    b.t.repo.create({ title: '데이터 바뀌어도 남을 일', date: TODAY })
    render(<App />)
    await screen.findByRole('navigation', { name: n.label })
    await user.click(item(n.memos))
    await user.type(await screen.findByLabelText(ko.memos.newLabel), '초안')
    const draft = memoInput()

    const memoReadsBefore = b.memos.list.mock.calls.length
    act(() => notifyDataChanged())
    await waitFor(() => expect(b.memos.list.mock.calls.length).toBeGreaterThan(memoReadsBefore))
    expect(memoInput()).toBe(draft)
    expect(draft.value).toBe('초안')

    // 초안을 버리고 할 일로 간다(초안이 남아 있으면 떠나기 확인이 먼저 뜬다).
    await user.click(item(n.tasks))
    await user.click(within(strip()).getByRole('button', { name: home.discardYes }))
    await openTaskPanel(user, '데이터 바뀌어도 남을 일')
    await user.type(within(panel()).getByLabelText(ko.tasks.detail.titleField), ' 수정')
    const listsBefore = b.tasks.list.mock.calls.length
    act(() => notifyDataChanged())
    await waitFor(() => expect(b.tasks.list.mock.calls.length).toBeGreaterThan(listsBefore))
    expect((within(panel()).getByLabelText(ko.tasks.detail.titleField) as HTMLInputElement).value).toBe('데이터 바뀌어도 남을 일 수정')
  })
})

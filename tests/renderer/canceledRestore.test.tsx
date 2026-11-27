// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { TasksScreen } from '../../src/renderer/tasks/TasksScreen'
import { installBackend, type Backend } from './backend'

// P2: 안 하기 → 6초 뒤에도 완료 보기의 '안 하기로 함'에서 보이고 → 다시 열기 → 원래 보기로 돌아간다. 재마운트해도 찾는다.

const TODAY = '2026-03-10'
const UNDO_MS = 6000
const t = ko.tasks

describe('안 하기로 함 되찾기', () => {
  let b: Backend
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    b = installBackend()
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  const nav = (): HTMLElement => screen.getByRole('navigation', { name: t.viewsNavLabel })
  const goTo = async (view: keyof typeof t.views): Promise<void> => {
    await user.click(within(nav()).getByRole('button', { name: new RegExp(`^${t.views[view]}`) }))
  }
  const canceledFilter = (): HTMLElement => screen.getByRole('button', { name: t.doneFilter.canceled })
  const reopenButton = (title: string): HTMLElement => screen.getByRole('button', { name: t.reopenLabel(title) })

  /** 상세 패널을 열어 [안 하기]를 누른다(실제 화면 흐름). */
  async function cancelFromPanel(title: string): Promise<void> {
    await user.click(await screen.findByText(title))
    await screen.findByRole('complementary', { name: t.detail.title })
    await user.click(await screen.findByRole('button', { name: t.detail.cancelTask }))
    await waitFor(() => expect(b.t.repo.listCanceled().map((x) => x.title)).toContain(title))
  }

  it('cancel -> still found after 6 seconds in 완료 > 안 하기로 함 -> reopen -> back in 오늘', async () => {
    b.t.repo.create({ title: '안 할 일', date: TODAY })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: ko.nav.tasks }))
    await cancelFromPanel('안 할 일')

    // 되돌리기 알림은 6초 뒤 사라진다.
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 200))
    expect(screen.queryByRole('status')).toBeNull()

    await goTo('done')
    await user.click(canceledFilter())
    expect(await screen.findByRole('button', { name: t.reopenLabel('안 할 일') })).toBeTruthy()

    await user.click(reopenButton('안 할 일'))
    await waitFor(() => expect(b.t.repo.listCanceled()).toEqual([]))
    expect(b.tasks.setStatus).toHaveBeenLastCalledWith(expect.any(String), 'open')
    await waitFor(() => expect(screen.queryByRole('button', { name: t.reopenLabel('안 할 일') })).toBeNull())

    await goTo('today')
    expect(await screen.findByText('안 할 일')).toBeTruthy()
  })

  it('the canceled list is still found after the screen is remounted', async () => {
    const task = b.t.repo.create({ title: '재마운트 뒤에도', date: TODAY })
    b.t.repo.setStatus(task.id, 'canceled')

    const first = render(<TasksScreen initialView="done" fadeMs={0} previewDebounceMs={0} />)
    await user.click(await screen.findByRole('button', { name: t.doneFilter.canceled }))
    expect(await screen.findByRole('button', { name: t.reopenLabel('재마운트 뒤에도') })).toBeTruthy()
    first.unmount()

    render(<TasksScreen initialView="done" fadeMs={0} previewDebounceMs={0} />)
    await user.click(await screen.findByRole('button', { name: t.doneFilter.canceled }))
    expect(await screen.findByRole('button', { name: t.reopenLabel('재마운트 뒤에도') })).toBeTruthy()
  })

  it('the 완료 filter shows done tasks, and canceled tasks never appear there', async () => {
    const done = b.t.repo.create({ title: '끝낸 일', date: TODAY })
    b.t.repo.setStatus(done.id, 'done')
    const canceled = b.t.repo.create({ title: '안 한 일', date: TODAY })
    b.t.repo.setStatus(canceled.id, 'canceled')

    render(<TasksScreen initialView="done" fadeMs={0} previewDebounceMs={0} />)
    expect(await screen.findByText('끝낸 일')).toBeTruthy()
    expect(screen.queryByText('안 한 일')).toBeNull()
    expect(screen.getByRole('button', { name: t.doneFilter.done }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the empty text when nothing was set aside', async () => {
    render(<TasksScreen initialView="done" fadeMs={0} previewDebounceMs={0} />)
    await user.click(await screen.findByRole('button', { name: t.doneFilter.canceled }))
    expect(await screen.findByText(t.empty.canceled)).toBeTruthy()
  })

  it('a failed reopen shows the error and keeps the row', async () => {
    const task = b.t.repo.create({ title: '실패할 일', date: TODAY })
    b.t.repo.setStatus(task.id, 'canceled')
    b.tasks.setStatus.mockImplementationOnce(async () => ({ ok: false, error: { code: 'internal' } }))

    render(<TasksScreen initialView="done" fadeMs={0} previewDebounceMs={0} />)
    await user.click(await screen.findByRole('button', { name: t.doneFilter.canceled }))
    await user.click(await screen.findByRole('button', { name: t.reopenLabel('실패할 일') }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: t.reopenLabel('실패할 일') })).toBeTruthy()
    expect(b.t.repo.get(task.id)?.status).toBe('canceled')
  })

  it('the canceled tasks do not count as done (view counts stay the same)', async () => {
    const done = b.t.repo.create({ title: '끝낸 일', date: TODAY })
    b.t.repo.setStatus(done.id, 'done')
    const canceled = b.t.repo.create({ title: '안 한 일', date: TODAY })
    b.t.repo.setStatus(canceled.id, 'canceled')

    render(<TasksScreen initialView="today" fadeMs={0} previewDebounceMs={0} />)
    await screen.findByText(t.empty.today)
    const doneNav = within(nav()).getByRole('button', { name: new RegExp(`^${t.views.done}`) })
    await waitFor(() => expect(within(doneNav).getByText('1')).toBeTruthy())
  })
})

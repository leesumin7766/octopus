// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// P3: 홈 '오늘 할 일' 카드에서 체크한 뒤 6초 동안 되돌리기 알림을 보여 준다(할 일 탭과 같은 동작).

const TODAY = '2026-03-10'
const UNDO_MS = 6000

describe('home today card: undo after checking', () => {
  let b: Backend
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    // 실제 시간 흐름을 따르는 가짜 타이머: 6초 창을 정확히 넘기면서도 waitFor 가 동작한다.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const start = (): void => {
    b = installBackend('home')
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App />)
  }
  const todoCard = (): Promise<HTMLElement> => screen.findByRole('region', { name: ko.home.cards.todo })
  const checkbox = (card: HTMLElement, title: string): HTMLInputElement =>
    within(card).getByRole('checkbox', { name: `${ko.tasks.complete}: ${title}` }) as HTMLInputElement
  const notice = (): HTMLElement | null => screen.queryByRole('status')
  const undoButton = (): HTMLElement => within(notice() as HTMLElement).getByRole('button', { name: ko.tasks.undo.button })

  it('check -> undo -> the task is back as open and unchecked in the card', async () => {
    start()
    const task = b.t.repo.create({ title: '되돌릴 일', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 되돌릴 일` }))

    expect((await screen.findByRole('status')).textContent).toContain(ko.tasks.undo.done('되돌릴 일'))
    await user.click(undoButton())

    await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('open'))
    expect(b.tasks.setStatus).toHaveBeenLastCalledWith(task.id, 'open')
    expect(await within(card).findByText('되돌릴 일')).toBeTruthy()
    expect(checkbox(card, '되돌릴 일').checked).toBe(false)
    expect(notice()).toBeNull()
  })

  it('the notice disappears by itself 6 seconds after checking', async () => {
    start()
    const task = b.t.repo.create({ title: '가만 둘 일', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 가만 둘 일` }))
    await screen.findByRole('status')

    await act(async () => vi.advanceTimersByTime(UNDO_MS - 100))
    expect(notice()).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(200))
    expect(notice()).toBeNull()
    expect(b.t.repo.get(task.id)?.status).toBe('done')
    expect(b.tasks.setStatus).toHaveBeenCalledTimes(1)
  })

  it('checking another task replaces the notice (latest wins) and restarts the 6 seconds', async () => {
    start()
    const first = b.t.repo.create({ title: '첫째', date: TODAY })
    const second = b.t.repo.create({ title: '둘째', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 첫째` }))
    await screen.findByRole('status')

    await act(async () => vi.advanceTimersByTime(4000))
    await user.click(checkbox(card, '둘째'))
    await waitFor(() => expect(b.t.repo.get(second.id)?.status).toBe('done'))

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(notice()?.textContent).toContain(ko.tasks.undo.done('둘째'))
    expect(notice()?.textContent).not.toContain(ko.tasks.undo.done('첫째'))

    // 둘째 체크 후 6초가 지나야 사라진다(첫째 알림의 남은 시간이 아니다).
    await act(async () => vi.advanceTimersByTime(UNDO_MS - 100))
    expect(notice()).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(200))
    expect(notice()).toBeNull()

    expect(b.t.repo.get(first.id)?.status).toBe('done')
  })

  it('undo after a replacement restores the latest task only', async () => {
    start()
    const first = b.t.repo.create({ title: '첫째', date: TODAY })
    const second = b.t.repo.create({ title: '둘째', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 첫째` }))
    await screen.findByRole('status')
    await user.click(checkbox(card, '둘째'))
    await waitFor(() => expect(b.t.repo.get(second.id)?.status).toBe('done'))

    await user.click(undoButton())

    await waitFor(() => expect(b.t.repo.get(second.id)?.status).toBe('open'))
    expect(b.t.repo.get(first.id)?.status).toBe('done')
  })

  it('when undo returns ok:false, the card shows the normal error and the task stays done', async () => {
    start()
    const task = b.t.repo.create({ title: '실패 되돌림', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 실패 되돌림` }))
    await screen.findByRole('status')
    b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })

    await user.click(undoButton())

    expect((await within(card).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(notice()).toBeNull()
    expect(b.t.repo.get(task.id)?.status).toBe('done')
  })

  it('when undo rejects, the card shows the normal error instead of crashing', async () => {
    start()
    const task = b.t.repo.create({ title: '예외 되돌림', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 예외 되돌림` }))
    await screen.findByRole('status')
    b.tasks.setStatus.mockRejectedValueOnce(new Error('ipc down'))

    await user.click(undoButton())

    expect((await within(card).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(b.t.repo.get(task.id)?.status).toBe('done')
  })

  it('a double click on undo sends one setStatus(open) request', async () => {
    start()
    const task = b.t.repo.create({ title: '연타 되돌림', date: TODAY })
    const card = await todoCard()
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 연타 되돌림` }))
    await screen.findByRole('status')
    const button = undoButton()
    b.tasks.setStatus.mockClear()

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('open'))
    const openCalls = b.tasks.setStatus.mock.calls.filter(([id, status]) => id === task.id && status === 'open')
    expect(openCalls).toHaveLength(1)
  })

  it('a routine item in the card gets the same undo notice and comes back unchecked', async () => {
    start()
    b.routineRepo.create({ title: '아침 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
    const card = await todoCard()
    const itemId = b.routineRepo.todayItems(TODAY)[0].id
    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` }))
    await waitFor(() => expect(b.routineRepo.todayItems(TODAY)[0].status).toBe('done'))

    expect(notice()?.textContent).toContain(ko.tasks.undo.done('아침 스트레칭'))
    await user.click(undoButton())

    await waitFor(() => expect(b.routineRepo.todayItems(TODAY)[0].status).toBe('open'))
    expect(b.tasks.setStatus).toHaveBeenLastCalledWith(itemId, 'open')
    expect(await within(card).findByText('아침 스트레칭')).toBeTruthy()
    expect(checkbox(card, '아침 스트레칭').checked).toBe(false)
  })

  it('a failed check shows no undo notice', async () => {
    start()
    b.t.repo.create({ title: '체크 실패', date: TODAY })
    b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    const card = await todoCard()

    await user.click(await within(card).findByRole('checkbox', { name: `${ko.tasks.complete}: 체크 실패` }))

    expect((await within(card).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(notice()).toBeNull()
  })
})

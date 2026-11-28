// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { TasksScreen } from '../../src/renderer/tasks/TasksScreen'
import { installBackend, type Backend } from './backend'

const t = ko.tasks
const R = ko.tasks.detail.repeatEdit

describe('tasks screen: list grouping, cancel/undo and repeat editing', () => {
  let b: Backend

  beforeEach(() => {
    // 2026-03-10(화) 정오
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  function renderScreen(view?: keyof typeof t.views): void {
    render(<TasksScreen fadeMs={0} previewDebounceMs={0} initialView={view} />)
  }

  const nav = (): HTMLElement => screen.getByRole('navigation', { name: t.viewsNavLabel })
  const goTo = async (user: ReturnType<typeof userEvent.setup>, view: keyof typeof t.views): Promise<void> => {
    await user.click(within(nav()).getByRole('button', { name: new RegExp(`^${t.views[view]}`) }))
  }
  const panel = (): HTMLElement => screen.getByRole('complementary', { name: t.detail.title })
  async function openPanel(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
    await user.click(await screen.findByText(title))
    await screen.findByRole('complementary', { name: t.detail.title })
  }

  describe('upcoming view groups by day', () => {
    it('one heading per day ("내일 · 3/11 (수)", "3/12 (목)"), with the tasks of that day under it', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '내일 일', date: '2026-03-11' })
      b.t.repo.create({ title: '모레 일 1', date: '2026-03-12', time: '09:00' })
      b.t.repo.create({ title: '모레 일 2', date: '2026-03-12', time: '15:00' })
      renderScreen()
      await goTo(user, 'upcoming')

      const tomorrow = await screen.findByRole('region', { name: '내일 · 3/11 (수)' })
      expect(within(tomorrow).getByText('내일 일')).toBeTruthy()
      const later = screen.getByRole('region', { name: '3/12 (목)' })
      expect(within(later).getByText('모레 일 1')).toBeTruthy()
      expect(within(later).getByText('모레 일 2')).toBeTruthy()
      expect(within(later).queryByText('내일 일')).toBeNull()
    })
  })

  describe('done view groups by the day it was finished and shows the time', () => {
    it('groups under the finishing day and each row says "HH:mm 완료"', async () => {
      const user = userEvent.setup()
      const a = b.t.repo.create({ title: '오늘 끝낸 일', date: '2026-03-10' })
      b.t.repo.setStatus(a.id, 'done') // 가짜 시계 정오 → 12:00 완료
      const c = b.t.repo.create({ title: '오늘 끝낸 둘째', date: '2026-03-10' })
      b.t.repo.setStatus(c.id, 'done')
      renderScreen()
      await goTo(user, 'done')

      const today = await screen.findByRole('region', { name: '오늘 · 3/10 (화)' })
      const row = within(today).getByText('오늘 끝낸 일').closest('li') as HTMLElement
      expect(row.textContent).toContain('12:00 완료')
      expect(within(today).getAllByRole('checkbox')).toHaveLength(2)
    })
  })

  describe('cancel and undo', () => {
    it('"취소" in the panel takes the task out of the list (not deleted) and offers "되돌리기"', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '취소할 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '취소할 일')

      await user.click(within(panel()).getByRole('button', { name: t.detail.cancelTask }))

      await waitFor(() => expect(b.tasks.setStatus).toHaveBeenCalledWith(task.id, 'canceled'))
      await waitFor(() => expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull())
      expect(screen.queryByText('취소할 일')).toBeNull()
      expect(b.t.repo.get(task.id)?.status).toBe('canceled') // 지워지지 않았다
      const notice = await screen.findByRole('status')
      expect(notice.textContent).toContain(t.undo.canceled('취소할 일'))
    })

    it('"되돌리기" after a cancel brings the task back to open', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '되돌릴 취소', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '되돌릴 취소')
      await user.click(within(panel()).getByRole('button', { name: t.detail.cancelTask }))

      await user.click(await screen.findByRole('button', { name: t.undo.button }))

      await waitFor(() => expect(b.tasks.setStatus).toHaveBeenLastCalledWith(task.id, 'open'))
      await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('open'))
      expect(await screen.findByText('되돌릴 취소')).toBeTruthy()
    })

    it('completing a task offers "되돌리기" that reopens it', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '끝낼 일', date: '2026-03-10' })
      renderScreen()

      await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 끝낼 일` }))
      await user.click(await screen.findByRole('button', { name: t.undo.button }))

      await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('open'))
    })

  })

  describe('repeat editing', () => {
    it('daily: choosing 매일 saves a daily rule', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '매일 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '매일 일')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'daily' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.tasks.update).toHaveBeenCalledWith(task.id, expect.objectContaining({ repeat: { freq: 'daily', interval: 1, anchor: '2026-03-10' } })))
      await waitFor(() => expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'daily', interval: 1, anchor: '2026-03-10' }))
    })

    it('an interval ("2주마다") is saved with the weekdays picked', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '격주 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '격주 일')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'weekly' } })
      // 기본은 날짜의 요일(3/10 화요일). 목요일을 더한다.
      await user.click(within(panel()).getByRole('button', { name: '목' }))
      fireEvent.change(within(panel()).getByLabelText(R.interval), { target: { value: '2' } })
      expect(within(panel()).getByText(R.preview('2주마다 화 목'))).toBeTruthy()
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'weekly', interval: 2, byWeekday: [2, 4], anchor: '2026-03-10' }))
    })

    it('a date is filled in with today when a repeat is turned on, and the task becomes scheduled', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '날짜 없던 반복' })
      renderScreen()
      await goTo(user, 'inbox')
      await openPanel(user, '날짜 없던 반복')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'daily' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.t.repo.get(task.id)).toMatchObject({ bucket: 'scheduled', date: '2026-03-10', repeat: { freq: 'daily', interval: 1 } }))
    })

    it('monthly keeps the day of the month (1-31)', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '월말 보고', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '월말 보고')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'monthly' } })
      fireEvent.change(within(panel()).getByLabelText(R.monthDayLabel), { target: { value: '31' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'monthly', interval: 1, byMonthDay: 31, anchor: '2026-03-10' }))
    })

    it('yearly and 평일 round-trip: saved, then shown again as chosen', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '평일 일', date: '2026-03-10', repeat: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] } })
      renderScreen()
      await openPanel(user, '평일 일')
      expect((within(panel()).getByLabelText(t.detail.repeat) as HTMLSelectElement).value).toBe('weekdays')
      await user.click(within(panel()).getByRole('button', { name: t.detail.close }))

      await openPanel(user, '평일 일')
      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'yearly' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'yearly', interval: 1, byMonth: 3, byMonthDay: 10, anchor: '2026-03-10' }))
    })

    it('a repeat left as it was keeps its anchor (even after the task date moved); a changed repeat starts over from the task date', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '격주 유지', date: '2026-03-10', repeat: { freq: 'weekly', interval: 2, byWeekday: [2], anchor: '2026-03-03' } })
      renderScreen()
      await openPanel(user, '격주 유지')
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))
      await waitFor(() => expect(b.tasks.update).toHaveBeenCalledTimes(1))
      expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'weekly', interval: 2, byWeekday: [2], anchor: '2026-03-03' }) // 기준일은 그대로

      await openPanel(user, '격주 유지')
      fireEvent.change(within(panel()).getByLabelText(R.interval), { target: { value: '3' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'weekly', interval: 3, byWeekday: [2], anchor: '2026-03-10' }))
    })

    it('an old repeat without an anchor is saved back unchanged (no anchor appears by itself)', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '옛 반복', date: '2026-03-10', repeat: { freq: 'daily', interval: 1 } })
      renderScreen()
      await openPanel(user, '옛 반복')

      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.tasks.update).toHaveBeenCalledTimes(1))
      expect(b.t.repo.get(task.id)?.repeat).toEqual({ freq: 'daily', interval: 1 })
    })

    it('choosing 없음 removes the repeat', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '반복 끄기', date: '2026-03-10', repeat: { freq: 'daily', interval: 1 } })
      renderScreen()
      await openPanel(user, '반복 끄기')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'none' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() => expect(b.t.repo.get(task.id)?.repeat).toBeNull())
    })

    it('a wrong interval is refused next to the field and nothing is saved', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '잘못된 간격', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '잘못된 간격')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'daily' } })
      fireEvent.change(within(panel()).getByLabelText(R.interval), { target: { value: '0' } })
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      expect(await within(panel()).findByText(R.errors.interval)).toBeTruthy()
      expect(b.tasks.update).not.toHaveBeenCalled()
    })

    it('weekly with no weekday picked is refused', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '요일 없음', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '요일 없음')

      fireEvent.change(within(panel()).getByLabelText(t.detail.repeat), { target: { value: 'weekly' } })
      await user.click(within(panel()).getByRole('button', { name: '화', pressed: true }))
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      expect(await within(panel()).findByText(R.errors.weekdays)).toBeTruthy()
      expect(b.tasks.update).not.toHaveBeenCalled()
    })

    it('a routine item cannot change its repeat', async () => {
      const user = userEvent.setup()
      b.routineRepo.create({ title: '루틴 항목', days: [0, 1, 2, 3, 4, 5, 6] }, '2026-03-10')
      renderScreen()
      await openPanel(user, '루틴 항목')

      expect((within(panel()).getByLabelText(t.detail.repeat) as HTMLSelectElement).disabled).toBe(true)
      expect(within(panel()).getByText(R.routineLocked)).toBeTruthy()
    })
  })
})

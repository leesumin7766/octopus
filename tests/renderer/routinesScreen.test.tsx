// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { formatDate } from '../../src/renderer/tasks/format'
import { RoutinesScreen } from '../../src/renderer/routines/RoutinesScreen'
import { installBackend, type Backend } from './backend'

const t = ko.routines
const TODAY = '2026-03-10' // 화요일
/** 칸의 이름에 쓰는 날짜 표기(오늘은 "오늘", 그 밖은 "3/8 (일)") */
const shown = (date: string): string => formatDate(date, TODAY)
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

describe('routines screen', () => {
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

  const todaySection = (): HTMLElement => screen.getByRole('region', { name: t.todayTitle })
  const manageSection = (): HTMLElement => screen.getByRole('region', { name: t.manageTitle })

  describe("today's checklist", () => {
    it('shows only the routines due today, as checkboxes', async () => {
      b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      b.routineRepo.create({ title: '일요일 청소', days: [0] }, TODAY)
      b.routineRepo.create({ title: '꺼진 루틴', days: EVERY_DAY, active: false }, TODAY)
      render(<RoutinesScreen />)

      expect(await within(todaySection()).findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` })).toBeTruthy()
      expect(within(todaySection()).queryByText('일요일 청소')).toBeNull()
      expect(within(todaySection()).queryByText('꺼진 루틴')).toBeNull()
    })

    it('checking and unchecking sets the status of today\'s routine task', async () => {
      const user = userEvent.setup()
      b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      const [item] = b.routineRepo.todayItems(TODAY)
      render(<RoutinesScreen />)

      const checkbox = (await within(todaySection()).findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` })) as HTMLInputElement
      expect(checkbox.checked).toBe(false)

      await user.click(checkbox)
      await waitFor(() => expect(b.tasks.setStatus).toHaveBeenCalledWith(item.id, 'done'))
      await waitFor(() => expect(checkbox.checked).toBe(true))
      expect(b.t.repo.get(item.id)?.status).toBe('done')

      await user.click(checkbox)
      await waitFor(() => expect(b.tasks.setStatus).toHaveBeenLastCalledWith(item.id, 'open'))
      await waitFor(() => expect(checkbox.checked).toBe(false))
      expect(b.t.repo.get(item.id)?.status).toBe('open')
    })

    it('says what to do when no routine is due today', async () => {
      render(<RoutinesScreen />)

      expect(await screen.findByText(t.todayEmpty)).toBeTruthy()
      expect(screen.getByText(t.empty)).toBeTruthy()
    })

    it('opening the screen makes today\'s items exactly once', async () => {
      b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, '2026-03-09') // 어제 만든 루틴
      expect(b.routineRepo.todayItems(TODAY)).toEqual([])

      render(<RoutinesScreen />)
      await within(todaySection()).findByText('아침 스트레칭')
      cleanup()
      render(<RoutinesScreen />)
      await within(todaySection()).findByText('아침 스트레칭')

      expect(b.routineRepo.todayItems(TODAY)).toHaveLength(1)
    })
  })

  describe('adding a routine', () => {
    it('creates it with the chosen days (every day by default) and shows it in both places', async () => {
      const user = userEvent.setup()
      render(<RoutinesScreen />)
      await screen.findByText(t.todayEmpty)

      await user.type(within(manageSection()).getByLabelText(t.nameLabel), '  물 마시기  ')
      await user.click(within(manageSection()).getByRole('button', { name: t.add }))

      await waitFor(() => expect(b.routines.create).toHaveBeenCalledWith({ title: '  물 마시기  ', days: EVERY_DAY }))
      expect(await within(todaySection()).findByText('물 마시기')).toBeTruthy()
      const row = within(manageSection()).getByText('물 마시기').closest('li') as HTMLElement
      expect(within(row).getByText('매일')).toBeTruthy()
      expect((within(manageSection()).getByLabelText(t.nameLabel) as HTMLInputElement).value).toBe('')
    })

    it('Enter in the name field adds it', async () => {
      const user = userEvent.setup()
      render(<RoutinesScreen />)
      await screen.findByText(t.todayEmpty)

      await user.type(within(manageSection()).getByLabelText(t.nameLabel), '일기 쓰기{Enter}')

      await waitFor(() => expect(b.routines.create).toHaveBeenCalledTimes(1))
    })

    it('"평일" and the day buttons choose the days', async () => {
      const user = userEvent.setup()
      render(<RoutinesScreen />)
      await screen.findByText(t.todayEmpty)
      const form = manageSection()

      await user.click(within(form).getByRole('button', { name: t.weekdays }))
      const monday = within(form).getByRole('button', { name: '월요일' })
      const saturday = within(form).getByRole('button', { name: '토요일' })
      expect(monday.getAttribute('aria-pressed')).toBe('true')
      expect(saturday.getAttribute('aria-pressed')).toBe('false')

      await user.click(monday) // 월요일 빼기
      await user.click(saturday) // 토요일 넣기
      await user.type(within(form).getByLabelText(t.nameLabel), '운동')
      await user.click(within(form).getByRole('button', { name: t.add }))

      await waitFor(() => expect(b.routines.create).toHaveBeenCalledWith({ title: '운동', days: [2, 3, 4, 5, 6] }))
      await within(form).findByText('화 수 목 금 토')
    })

    it('"매일" selects every day again', async () => {
      const user = userEvent.setup()
      render(<RoutinesScreen />)
      await screen.findByText(t.todayEmpty)
      const form = manageSection()

      await user.click(within(form).getByRole('button', { name: t.weekdays }))
      await user.click(within(form).getByRole('button', { name: t.everyDay }))

      expect(within(form).getByRole('button', { name: '일요일' }).getAttribute('aria-pressed')).toBe('true')
      expect(within(form).getByRole('button', { name: t.everyDay }).getAttribute('aria-pressed')).toBe('true')
    })

    it('shows a message next to the field when the name is empty or no day is chosen', async () => {
      const user = userEvent.setup()
      render(<RoutinesScreen />)
      await screen.findByText(t.todayEmpty)
      const form = manageSection()

      await user.click(within(form).getByRole('button', { name: t.add }))
      expect(await within(form).findByText(t.fieldErrors.title)).toBeTruthy()

      await user.type(within(form).getByLabelText(t.nameLabel), '이름')
      for (const day of t.weekdayLong) await user.click(within(form).getByRole('button', { name: day }))
      await user.click(within(form).getByRole('button', { name: t.add }))
      expect(await within(form).findByText(t.fieldErrors.days)).toBeTruthy()
      expect(b.routineRepo.list()).toEqual([])
    })

    it('shows an error banner for other failures and keeps the typed name', async () => {
      const user = userEvent.setup()
      b.routines.create.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      render(<RoutinesScreen />)
      await screen.findByText(t.todayEmpty)

      await user.type(within(manageSection()).getByLabelText(t.nameLabel), '남아야 하는 이름{Enter}')

      expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect((within(manageSection()).getByLabelText(t.nameLabel) as HTMLInputElement).value).toBe('남아야 하는 이름')
    })
  })

  describe('editing, turning off and deleting', () => {
    it('edits the name and days', async () => {
      const user = userEvent.setup()
      const routine = b.routineRepo.create({ title: '스트레칭', days: EVERY_DAY }, TODAY)
      render(<RoutinesScreen />)
      await within(manageSection()).findByText('스트레칭')

      await user.click(within(manageSection()).getByRole('button', { name: t.edit }))
      const name = within(manageSection()).getAllByLabelText(t.nameLabel)[1] as HTMLInputElement
      expect(name.value).toBe('스트레칭')
      await user.clear(name)
      await user.type(name, '아침 스트레칭')
      await user.click(within(manageSection()).getAllByRole('button', { name: t.weekdays })[1])
      await user.click(within(manageSection()).getByRole('button', { name: t.save }))

      await waitFor(() =>
        expect(b.routines.update).toHaveBeenCalledWith(routine.id, { title: '아침 스트레칭', days: [1, 2, 3, 4, 5] })
      )
      expect(await within(manageSection()).findByText('아침 스트레칭')).toBeTruthy()
      const row = within(manageSection()).getByText('아침 스트레칭').closest('li') as HTMLElement
      expect(within(row).getByText('평일')).toBeTruthy()
      expect(b.routineRepo.get(routine.id)).toMatchObject({ title: '아침 스트레칭', days: [1, 2, 3, 4, 5] })
    })

    it('cancelling an edit changes nothing', async () => {
      const user = userEvent.setup()
      b.routineRepo.create({ title: '스트레칭', days: EVERY_DAY }, TODAY)
      render(<RoutinesScreen />)
      await within(manageSection()).findByText('스트레칭')

      await user.click(within(manageSection()).getByRole('button', { name: t.edit }))
      await user.click(within(manageSection()).getByRole('button', { name: t.cancel }))

      expect(b.routines.update).not.toHaveBeenCalled()
      expect(within(manageSection()).getByRole('button', { name: t.edit })).toBeTruthy()
    })

    it('turning a routine off removes today\'s item; turning it on brings it back', async () => {
      const user = userEvent.setup()
      const routine = b.routineRepo.create({ title: '스트레칭', days: EVERY_DAY }, TODAY)
      render(<RoutinesScreen />)
      await within(todaySection()).findByText('스트레칭')

      await user.click(within(manageSection()).getByRole('button', { name: t.turnOff }))

      await waitFor(() => expect(b.routines.update).toHaveBeenCalledWith(routine.id, { active: false }))
      await waitFor(() => expect(within(todaySection()).queryByText('스트레칭')).toBeNull())
      expect(within(manageSection()).getByText(t.off)).toBeTruthy()

      await user.click(within(manageSection()).getByRole('button', { name: t.turnOn }))

      await waitFor(() => expect(b.routines.update).toHaveBeenLastCalledWith(routine.id, { active: true }))
      expect(await within(todaySection()).findByText('스트레칭')).toBeTruthy()
    })

    it('delete asks first, and keeps past records', async () => {
      const user = userEvent.setup()
      const routine = b.routineRepo.create({ title: '스트레칭', days: EVERY_DAY }, TODAY)
      const past = b.t.repo.create({ title: '스트레칭', bucket: 'scheduled', date: '2026-03-08', routineId: routine.id })
      b.t.repo.setStatus(past.id, 'done')
      render(<RoutinesScreen />)
      await within(manageSection()).findByText('스트레칭')

      await user.click(within(manageSection()).getByRole('button', { name: t.remove }))
      const dialog = within(manageSection()).getByRole('alertdialog')
      expect(within(dialog).getByText(t.confirmRemove)).toBeTruthy()
      expect(b.routines.remove).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: t.cancel }))
      expect(within(manageSection()).queryByRole('alertdialog')).toBeNull()

      await user.click(within(manageSection()).getByRole('button', { name: t.remove }))
      await user.click(within(within(manageSection()).getByRole('alertdialog')).getByRole('button', { name: t.confirmRemoveYes }))

      await waitFor(() => expect(b.routines.remove).toHaveBeenCalledWith(routine.id))
      await waitFor(() => expect(within(manageSection()).queryByText('스트레칭')).toBeNull())
      expect(b.t.repo.get(past.id)?.status).toBe('done') // 지난 기록은 남음
    })
  })

  describe('order', () => {
    it('the arrows move a routine, the first has no up arrow and the last has no down arrow', async () => {
      const user = userEvent.setup()
      b.routineRepo.create({ title: '첫째', days: EVERY_DAY }, TODAY)
      b.routineRepo.create({ title: '둘째', days: EVERY_DAY }, TODAY)
      render(<RoutinesScreen />)
      await within(manageSection()).findByText('둘째')

      expect((within(manageSection()).getByRole('button', { name: `${t.moveUp}: 첫째` }) as HTMLButtonElement).disabled).toBe(true)
      expect((within(manageSection()).getByRole('button', { name: `${t.moveDown}: 둘째` }) as HTMLButtonElement).disabled).toBe(true)

      await user.click(within(manageSection()).getByRole('button', { name: `${t.moveDown}: 첫째` }))

      await waitFor(() => expect(b.routines.move).toHaveBeenCalledWith(expect.any(String), 'down'))
      await waitFor(() => {
        const titles = within(manageSection()).getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent)
        expect(titles.slice(0, 2)).toEqual(['둘째', '첫째'])
      })
    })
  })

  describe('14-day history', () => {
    it('shows done, missed, in-progress and not-applicable cells', async () => {
      const routine = b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      const task = (date: string) => b.t.repo.create({ title: '아침 스트레칭', bucket: 'scheduled', date, routineId: routine.id })
      b.t.repo.setStatus(task('2026-03-08').id, 'done')
      task('2026-03-09') // 열린 채로 남은 어제 = 못 함
      render(<RoutinesScreen />)

      const table = await screen.findByRole('table', { name: t.historyTitle(14) })
      const cell = (date: string) => within(table).getByLabelText(`아침 스트레칭 ${shown(date)}: `, { exact: false })
      expect(within(table).getByLabelText(`아침 스트레칭 ${shown('2026-03-08')}: ${t.cell.done}`).textContent).toBe('✓')
      expect(within(table).getByLabelText(`아침 스트레칭 ${shown('2026-03-09')}: ${t.cell.missed}`).textContent).toBe('✕')
      expect(within(table).getByLabelText(`아침 스트레칭 ${shown(TODAY)}: ${t.cell.pending}`).textContent).toBe('○')
      expect(within(table).getByLabelText(`아침 스트레칭 ${shown('2026-03-07')}: ${t.cell.none}`).textContent).toBe('·')
      expect(cell('2026-02-25')).toBeTruthy() // 14일 전체가 열로 나온다
      expect(within(table).getAllByRole('columnheader')).toHaveLength(15) // 이름 칸 + 14일
    })

    it('checking today\'s box turns today\'s history cell into done', async () => {
      const user = userEvent.setup()
      b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      render(<RoutinesScreen />)

      await user.click(await within(todaySection()).findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` }))

      await waitFor(() => expect(screen.getByLabelText(`아침 스트레칭 ${shown(TODAY)}: ${t.cell.done}`)).toBeTruthy())
    })

    it('has a hint instead of a table when there are no routines', async () => {
      render(<RoutinesScreen />)

      expect(await screen.findByText(t.historyEmpty)).toBeTruthy()
      expect(screen.queryByRole('table')).toBeNull()
    })
  })

  it('shows the message for db_unavailable and can dismiss it', async () => {
    const user = userEvent.setup()
    b.routines.list.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
    render(<RoutinesScreen />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(ko.tasks.errors.db_unavailable)

    await user.click(within(alert).getByRole('button', { name: ko.tasks.errors.dismiss }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reloads when the window gets focus again', async () => {
    render(<RoutinesScreen />)
    await screen.findByText(t.todayEmpty)
    b.routineRepo.create({ title: '밖에서 만든 루틴', days: EVERY_DAY }, TODAY)

    fireEvent(window, new Event('focus'))

    expect(await within(todaySection()).findByText('밖에서 만든 루틴')).toBeTruthy()
  })
})

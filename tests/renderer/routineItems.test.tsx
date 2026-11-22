// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { TasksScreen } from '../../src/renderer/tasks/TasksScreen'
import { installBackend, type Backend } from './backend'

const t = ko.tasks
const TODAY = '2026-03-10'
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

describe('routine items in the task screen', () => {
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

  const nav = (): HTMLElement => screen.getByRole('navigation', { name: t.viewsNavLabel })

  it('the done view and its count leave out routine records', async () => {
    const user = userEvent.setup()
    const routine = b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
    b.t.repo.setStatus(b.routineRepo.todayItems(TODAY)[0].id, 'done') // 오늘 루틴 완료
    const past = b.t.repo.create({ title: '아침 스트레칭', bucket: 'scheduled', date: '2026-03-09', routineId: routine.id })
    b.t.repo.setStatus(past.id, 'done') // 어제 루틴 기록
    const ordinary = b.t.repo.create({ title: '일반 할 일', date: TODAY })
    b.t.repo.setStatus(ordinary.id, 'done')
    render(<TasksScreen fadeMs={0} previewDebounceMs={0} />)

    const doneButton = await within(nav()).findByRole('button', { name: /^완료/ })
    await waitFor(() => expect(doneButton.textContent).toBe('완료1'))

    await user.click(doneButton)
    expect(await screen.findByText('일반 할 일')).toBeTruthy()
    expect(screen.queryByText('아침 스트레칭')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('a routine item in the detail panel has no delete button, and says where to manage it', async () => {
    const user = userEvent.setup()
    b.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
    render(<TasksScreen fadeMs={0} previewDebounceMs={0} />)

    await user.click(await screen.findByText('아침 스트레칭'))

    const panel = await screen.findByRole('complementary', { name: t.detail.title })
    expect(within(panel).queryByRole('button', { name: t.detail.remove })).toBeNull()
    expect(within(panel).getByText(t.detail.routineManage)).toBeTruthy()
    expect(within(panel).getByRole('button', { name: t.detail.save })).toBeTruthy()
  })

  it('an ordinary task still has its delete button and no routine guidance', async () => {
    const user = userEvent.setup()
    b.t.repo.create({ title: '일반 할 일', date: TODAY })
    render(<TasksScreen fadeMs={0} previewDebounceMs={0} />)

    await user.click(await screen.findByText('일반 할 일'))

    const panel = await screen.findByRole('complementary', { name: t.detail.title })
    expect(within(panel).getByRole('button', { name: t.detail.remove })).toBeTruthy()
    expect(within(panel).queryByText(t.detail.routineManage)).toBeNull()
  })
})

// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import type { RepeatRule } from '../../src/shared/tasks/types'
import { installBackend, type Backend } from './backend'

// C3: 앞으로의 반복 회차는 저장하지 않고 계산만 해서 흐리게 보인다(달 칸의 흐린 표시, 날짜 상세의 '예정(반복)' 줄).
// 2026-11-25(수) 정오. 11월 격자는 11/01(일) ~ 12/12(토).
const m = ko.home.localCalendar
const TODAY = '2026-11-25'

describe('future repeats are shown dimmed (not stored)', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
    b = installBackend('home')
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  const rowCount = (): number => (b.t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n
  const grid = (): HTMLElement => screen.getByRole('region', { name: ko.calendarScreen.title })
  const cell = (date: string): HTMLElement => grid().querySelector(`[data-date="${date}"]`) as HTMLElement
  const weeklyMonday: RepeatRule = { freq: 'weekly', interval: 1, byWeekday: [1], anchor: '2026-11-23' }

  async function openTab(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.calendar }))
    await screen.findByRole('heading', { level: 1, name: ko.calendarScreen.title })
    return user
  }

  it('a weekly Monday repeat shows dimmed marks on the later Mondays; no rows are added', async () => {
    b.t.repo.create({ title: '주간 점검', date: '2026-11-23', repeat: weeklyMonday })
    const before = rowCount()
    await openTab()

    await waitFor(() => expect(cell('2026-11-30').getAttribute('aria-label')).toContain(m.ghostCount(1)))
    expect(cell('2026-12-07').getAttribute('aria-label')).toContain(m.ghostCount(1))
    // 그 밖의 날(화요일, 지난 월요일)에는 없다
    expect(cell('2026-12-01').getAttribute('aria-label')).not.toContain(m.ghostCount(1))
    expect(cell('2026-11-23').getAttribute('aria-label')).not.toContain(m.ghostCount(1))
    expect(rowCount()).toBe(before)
  })

  it('the home calendar card shows them too', async () => {
    b.t.repo.create({ title: '주간 점검', date: '2026-11-23', repeat: weeklyMonday })
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.calendar })
    await waitFor(() => expect((card.querySelector('[data-date="2026-11-30"]') as HTMLElement).getAttribute('aria-label')).toContain(m.ghostCount(1)))
  })

  it('the day detail shows a dimmed "예정(반복)" line that cannot be checked, and clicking it opens the real occurrence', async () => {
    b.t.repo.create({ title: '주간 점검', date: '2026-11-23', repeat: weeklyMonday })
    const user = await openTab()
    await user.click(cell('2026-12-07'))
    const panel = await screen.findByRole('region', { name: ko.home.localCalendar.ghostHeading })
    expect(within(panel).getByText('주간 점검')).toBeTruthy()
    expect(within(panel).queryByRole('checkbox')).toBeNull()

    await user.click(within(panel).getByRole('button', { name: m.ghostOpen('주간 점검') }))
    const detail = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
    expect((within(detail).getByLabelText(ko.tasks.detail.titleField) as HTMLInputElement).value).toBe('주간 점검')
    expect((within(detail).getByLabelText(ko.tasks.detail.date) as HTMLInputElement).value).toBe('2026-11-23')
  })

  it('completing the real occurrence: the next one becomes real and no longer overlaps a dimmed mark', async () => {
    const task = b.t.repo.create({ title: '주간 점검', date: '2026-11-23', repeat: weeklyMonday })
    const user = await openTab()
    await waitFor(() => expect(cell('2026-11-30').getAttribute('aria-label')).toContain(m.ghostCount(1)))

    // 날짜 상세에서 실제 회차(11/23)를 체크 → 다음 회차(11/30)가 실제 할 일이 된다
    await user.click(cell('2026-11-23'))
    await user.click(await screen.findByRole('checkbox', { name: ko.home.localCalendar.toggleLabel('주간 점검') }))
    await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('done'))
    await waitFor(() => expect(cell('2026-11-30').getAttribute('aria-label')).toContain(m.dayCount(1, 0)), { timeout: 4000 })
    // 흐린 표시는 다시 계산되는 중일 수 있어 기다린다(부하가 있어도 흔들리지 않게 시간을 넉넉히)
    await waitFor(
      () => {
        expect(cell('2026-11-30').getAttribute('aria-label')).not.toContain(m.ghostCount(1))
        expect(cell('2026-12-07').getAttribute('aria-label')).toContain(m.ghostCount(1))
      },
      { timeout: 4000 }
    )
  })

  it('checklist items show dimmed on future days; today and past days are left alone', async () => {
    b.routineRepo.create({ title: '체크 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
    await openTab()
    await waitFor(() => expect(cell('2026-11-30').getAttribute('aria-label')).toContain(m.ghostCount(1)))
    expect(cell('2026-11-24').getAttribute('aria-label')).not.toContain(m.ghostCount(1))
    const user = userEvent.setup()
    await user.click(cell('2026-11-30'))
    const panel = await screen.findByRole('region', { name: m.ghostHeading })
    expect(within(panel).getByText('체크 스트레칭')).toBeTruthy()
    expect(within(panel).queryByRole('button')).toBeNull() // 실제 회차가 없어 눌러서 갈 곳이 없다
  })
})

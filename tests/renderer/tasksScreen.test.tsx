// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyDataChanged } from '../../src/renderer/dataEvents'
import { ko } from '../../src/renderer/i18n/ko'
import { TasksScreen } from '../../src/renderer/tasks/TasksScreen'
import type { RepeatRule, Task } from '../../src/shared/tasks/types'
import { installBackend, type Backend } from './backend'

const t = ko.tasks
const WEEKLY_MONDAY: RepeatRule = { freq: 'weekly', interval: 1, byWeekday: [1] }

describe('tasks screen', () => {
  let b: Backend

  beforeEach(() => {
    // 2026-03-10(화) 로컬 정오. 타이머는 진짜를 쓰고 Date 만 고정한다.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  function renderScreen(): void {
    render(<TasksScreen fadeMs={0} previewDebounceMs={0} />)
  }

  const nav = (): HTMLElement => screen.getByRole('navigation', { name: t.viewsNavLabel })
  const goTo = async (user: ReturnType<typeof userEvent.setup>, view: keyof typeof t.views): Promise<void> => {
    await user.click(within(nav()).getByRole('button', { name: new RegExp(`^${t.views[view]}`) }))
  }

  describe('quick input', () => {
    it('Enter calls quickAdd, clears the input and refreshes the list', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty.today)
      const input = screen.getByLabelText(t.quickInputLabel) as HTMLInputElement

      await user.type(input, '오늘 보고서 쓰기{Enter}')

      await waitFor(() => expect(b.tasks.quickAdd).toHaveBeenCalledWith('오늘 보고서 쓰기'))
      await waitFor(() => expect(input.value).toBe(''))
      expect(await screen.findByText('보고서 쓰기')).toBeTruthy()
      expect(screen.queryByText(t.empty.today)).toBeNull()
    })

    it('shows what was recognized as chips while typing', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty.today)

      await user.type(screen.getByLabelText(t.quickInputLabel), '내일 오후 3시 보고서 #업무 !높음')

      const chips = await screen.findByRole('list', { name: t.previewLabel })
      await waitFor(() => {
        const text = chips.textContent ?? ''
        expect(text).toContain('내일')
        expect(text).toContain('15:00')
        expect(text).toContain('#업무')
        expect(text).toContain('높음')
      })
      expect(b.tasks.parsePreview).toHaveBeenCalledWith('내일 오후 3시 보고서 #업무 !높음')
      expect(b.tasks.quickAdd).not.toHaveBeenCalled()
    })

    it('shows a repeat chip', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty.today)

      await user.type(screen.getByLabelText(t.quickInputLabel), '매주 월 회의')

      const chips = await screen.findByRole('list', { name: t.previewLabel })
      await waitFor(() => expect(chips.textContent).toContain('매주 월'))
    })

    it('ignores Enter while a Korean character is still being composed', async () => {
      renderScreen()
      await screen.findByText(t.empty.today)
      const input = screen.getByLabelText(t.quickInputLabel)
      fireEvent.change(input, { target: { value: '회의' } })

      fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
      expect(b.tasks.quickAdd).not.toHaveBeenCalled()

      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(b.tasks.quickAdd).toHaveBeenCalledWith('회의'))
    })

    it('does nothing for blank text', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty.today)

      await user.type(screen.getByLabelText(t.quickInputLabel), '   {Enter}')

      expect(b.tasks.quickAdd).not.toHaveBeenCalled()
    })

    it('N and / focus the input, but typing those letters in the input does not', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty.today)
      const input = screen.getByLabelText(t.quickInputLabel) as HTMLInputElement

      await user.keyboard('n')
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('')

      await user.keyboard('n/N')
      expect(input.value).toBe('n/N')

      input.blur()
      await user.keyboard('/')
      expect(document.activeElement).toBe(input)
    })
  })

  describe('list rows', () => {
    it('shows date, time, deadline (highlighted when past), project, priority and repeat', async () => {
      b.t.repo.create({
        title: '주간 보고',
        date: '2026-03-10',
        time: '09:30',
        deadline: '2026-03-09',
        project: '업무',
        priority: 3,
        repeat: WEEKLY_MONDAY
      })
      renderScreen()

      const row = (await screen.findByText('주간 보고')).closest('li') as HTMLElement
      expect(row.textContent).toContain('오늘 09:30')
      expect(row.textContent).toContain('#업무')
      expect(row.textContent).toContain('!높음')
      expect(row.textContent).toContain('↻ 매주 월')
      const deadline = within(row).getByText(/마감/)
      expect(deadline.textContent).toContain('어제')
      expect(deadline.className).toContain('text-red-700')
    })

    it('a deadline that is not past is not highlighted', async () => {
      b.t.repo.create({ title: '여유', date: '2026-03-10', deadline: '2026-03-20' })
      renderScreen()

      const row = (await screen.findByText('여유')).closest('li') as HTMLElement
      expect(within(row).getByText(/마감/).className).not.toContain('text-red-700')
    })

    it('shows counts next to each view', async () => {
      b.t.repo.create({ title: 'a' })
      b.t.repo.create({ title: 'b', date: '2026-03-10' })
      b.t.repo.create({ title: 'c', date: '2026-03-08' })
      b.t.repo.create({ title: 'd', date: '2026-03-15' })
      renderScreen()
      await screen.findByText('b')

      const text = (view: keyof typeof t.views): string =>
        within(nav()).getByRole('button', { name: new RegExp(`^${t.views[view]}`) }).textContent ?? ''
      expect(text('inbox')).toBe('수신함1')
      expect(text('today')).toBe('오늘2')
      expect(text('upcoming')).toBe('예정1')
      expect(text('someday')).toBe('나중에0')
      expect(text('done')).toBe('완료0')
    })
  })

  describe('completing', () => {
    it('checking calls setStatus("done") and the row goes away; unchecking in the done view reopens it', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '체크할 일', date: '2026-03-10' })
      renderScreen()

      await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 체크할 일` }))

      await waitFor(() => expect(b.tasks.setStatus).toHaveBeenCalledWith(task.id, 'done'))
      await waitFor(() => expect(screen.queryByText('체크할 일')).toBeNull())

      await goTo(user, 'done')
      const checkbox = (await screen.findByRole('checkbox', { name: `${t.complete}: 체크할 일` })) as HTMLInputElement
      expect(checkbox.checked).toBe(true)

      await user.click(checkbox)

      await waitFor(() => expect(b.tasks.setStatus).toHaveBeenLastCalledWith(task.id, 'open'))
      await waitFor(() => expect(screen.queryByText('체크할 일')).toBeNull())
      expect(b.t.repo.get(task.id)?.status).toBe('open')
    })

    it('a repeating task comes back as its next occurrence', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '매일 운동', date: '2026-03-10', repeat: { freq: 'daily', interval: 1 } })
      renderScreen()

      await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 매일 운동` }))

      await goTo(user, 'upcoming')
      const row = (await screen.findByText('매일 운동')).closest('li') as HTMLElement
      expect(row.textContent).toContain('내일')
    })

    it('shows an error and keeps the row when setStatus fails', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '실패할 일', date: '2026-03-10' })
      b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      renderScreen()

      await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 실패할 일` }))

      expect((await screen.findByRole('alert')).textContent).toContain(t.errors.internal)
      expect(screen.getByText('실패할 일')).toBeTruthy()
    })
  })

  describe('overdue section', () => {
    function seedOverdue() {
      const a = b.t.repo.create({ title: '밀린 A', date: '2026-03-08' })
      const c = b.t.repo.create({ title: '밀린 B', date: '2026-03-09' })
      const repeating = b.t.repo.create({ title: '밀린 반복', date: '2026-03-09', repeat: WEEKLY_MONDAY })
      b.t.repo.create({ title: '오늘 일', date: '2026-03-10' })
      return { a, c, repeating }
    }
    const section = (): HTMLElement => screen.getByRole('region', { name: t.overdue.title })

    it('lists overdue tasks above today, separately', async () => {
      seedOverdue()
      renderScreen()

      const overdue = await screen.findByRole('region', { name: t.overdue.title })
      expect(within(overdue).getByText('밀린 A')).toBeTruthy()
      expect(within(overdue).queryByText('오늘 일')).toBeNull()
      expect(within(screen.getByRole('region', { name: t.todaySection })).getByText('오늘 일')).toBeTruthy()
    })

    const row = (title: string): HTMLElement => within(section()).getByText(title).closest('li') as HTMLElement

    it('the row "오늘로" button sends that one task', async () => {
      const user = userEvent.setup()
      const { a } = seedOverdue()
      renderScreen()
      await screen.findByRole('region', { name: t.overdue.title })

      await user.click(within(row('밀린 A')).getByRole('button', { name: t.overdue.toToday }))

      await waitFor(() => expect(b.tasks.moveToToday).toHaveBeenCalledWith([a.id]))
      await waitFor(() => expect(within(section()).queryByText('밀린 A')).toBeNull())
      expect(within(screen.getByRole('region', { name: t.todaySection })).getByText('밀린 A')).toBeTruthy()
    })

    it('"전부 오늘로" sends every overdue id', async () => {
      const user = userEvent.setup()
      const { a, c, repeating } = seedOverdue()
      renderScreen()
      await screen.findByRole('region', { name: t.overdue.title })

      await user.click(within(section()).getByRole('button', { name: t.overdue.allToToday }))

      await waitFor(() => expect(b.tasks.moveToToday).toHaveBeenCalledWith(expect.arrayContaining([a.id, c.id, repeating.id])))
      await waitFor(() => expect(screen.queryByRole('region', { name: t.overdue.title })).toBeNull())
    })

    it('a row "날짜…" opens a date box, and the chosen date reschedules that task', async () => {
      const user = userEvent.setup()
      const { a } = seedOverdue()
      renderScreen()
      await screen.findByRole('region', { name: t.overdue.title })

      expect(within(section()).queryByLabelText(`${t.overdue.dateLabel}: 밀린 A`)).toBeNull()
      await user.click(within(row('밀린 A')).getByRole('button', { name: `${t.overdue.reschedule}: 밀린 A` }))
      fireEvent.change(within(section()).getByLabelText(`${t.overdue.dateLabel}: 밀린 A`), { target: { value: '2026-03-20' } })

      await waitFor(() => expect(b.tasks.reschedule).toHaveBeenCalledWith([a.id], '2026-03-20'))
    })

    it('a repeating row\'s "나중에" is disabled with the reason', async () => {
      seedOverdue()
      renderScreen()
      await screen.findByRole('region', { name: t.overdue.title })

      const blocked = within(row('밀린 반복')).getByRole('button', { name: t.overdue.toSomeday }) as HTMLButtonElement
      expect(blocked.disabled).toBe(true)
      expect(blocked.title).toBe(t.overdue.repeatBlocksSomeday)
      expect((within(row('밀린 A')).getByRole('button', { name: t.overdue.toSomeday }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('"전부 나중에" skips repeating tasks and says so', async () => {
      const user = userEvent.setup()
      const { a, c } = seedOverdue()
      renderScreen()
      await screen.findByRole('region', { name: t.overdue.title })

      await user.click(within(section()).getByRole('button', { name: t.overdue.allToSomeday }))

      await waitFor(() => expect(b.tasks.moveToSomeday).toHaveBeenCalledWith(expect.arrayContaining([a.id, c.id])))
      expect(b.tasks.moveToSomeday.mock.calls[0][0]).toHaveLength(2)
      expect(await within(section()).findByText(t.overdue.keptRepeating(1))).toBeTruthy()
      expect(within(section()).getByText('밀린 반복')).toBeTruthy()
    })

    it('is not shown when nothing is overdue', async () => {
      b.t.repo.create({ title: '오늘 일', date: '2026-03-10' })
      renderScreen()
      await screen.findByText('오늘 일')

      expect(screen.queryByRole('region', { name: t.overdue.title })).toBeNull()
    })
  })

  describe('detail panel', () => {
    const panel = (): HTMLElement => screen.getByRole('complementary', { name: t.detail.title })

    async function openPanel(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
      await user.click(await screen.findByText(title))
      await screen.findByRole('complementary', { name: t.detail.title })
    }

    it('shows the task and saves edits with update', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '고칠 일', date: '2026-03-10', priority: 1, tags: ['a'] })
      renderScreen()
      await openPanel(user, '고칠 일')

      expect((within(panel()).getByLabelText(t.detail.titleField) as HTMLInputElement).value).toBe('고칠 일')
      expect((within(panel()).getByLabelText(t.detail.date) as HTMLInputElement).value).toBe('2026-03-10')

      const title = within(panel()).getByLabelText(t.detail.titleField)
      await user.clear(title)
      await user.type(title, '고친 일')
      await user.type(within(panel()).getByLabelText(t.detail.notes), '첫 줄{Enter}둘째 줄')
      fireEvent.change(within(panel()).getByLabelText(t.detail.priority), { target: { value: '3' } })
      fireEvent.change(within(panel()).getByLabelText(t.detail.time), { target: { value: '14:30' } })
      fireEvent.change(within(panel()).getByLabelText(t.detail.deadline), { target: { value: '2026-03-12' } })
      await user.type(within(panel()).getByLabelText(t.detail.project), ' 업무 ')
      await user.clear(within(panel()).getByLabelText(t.detail.tags))
      await user.type(within(panel()).getByLabelText(t.detail.tags), 'x, y, ,x')
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      await waitFor(() =>
        expect(b.tasks.update).toHaveBeenCalledWith(task.id, {
          title: '고친 일',
          notes: '첫 줄\n둘째 줄',
          bucket: 'scheduled',
          date: '2026-03-10',
          time: '14:30',
          deadline: '2026-03-12',
          priority: 3,
          project: '업무',
          tags: ['x', 'y'],
          repeat: null
        })
      )
      await waitFor(() => expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull())
      expect(await screen.findByText('고친 일')).toBeTruthy()
      expect(b.t.repo.get(task.id)).toMatchObject({ title: '고친 일', priority: 3, tags: ['x', 'y'] })
    })

    it('shows the message next to the field when the title is empty', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '제목 비울 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '제목 비울 일')

      await user.clear(within(panel()).getByLabelText(t.detail.titleField))
      await user.click(within(panel()).getByRole('button', { name: t.detail.save }))

      const message = await within(panel()).findByText(t.fieldErrors.title)
      expect(message.closest('div')?.querySelector('#task-title')).not.toBeNull()
      expect(panel()).toBeTruthy() // 닫히지 않는다
      expect(b.t.repo.listView('today', '2026-03-10').today[0].title).toBe('제목 비울 일')
    })

    const saveBtn = (): HTMLElement => within(panel()).getByRole('button', { name: t.detail.save })
    const bucketOf = (title: string): string | undefined =>
      (['inbox', 'upcoming', 'someday'] as const).map((v) => b.t.repo.listView(v, '2026-03-10')).flatMap((r) => Object.values(r).flat() as Task[]).find((x) => x.title === title)?.bucket

    it('has no 보관함 field', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '칸 없는 일' })
      renderScreen()
      await goTo(user, 'inbox')
      await openPanel(user, '칸 없는 일')
      expect(panel().querySelector('#task-bucket')).toBeNull()
    })

    it('saving with a date makes it 예정; clearing the date saves to 수신함 without an error', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '날짜 붙일 일' })
      renderScreen()
      await goTo(user, 'inbox')
      await openPanel(user, '날짜 붙일 일')

      fireEvent.change(within(panel()).getByLabelText(t.detail.date), { target: { value: '2026-03-20' } })
      await user.click(saveBtn())
      await waitFor(() => expect(bucketOf('날짜 붙일 일')).toBe('scheduled'))

      await goTo(user, 'upcoming')
      await openPanel(user, '날짜 붙일 일')
      fireEvent.change(within(panel()).getByLabelText(t.detail.date), { target: { value: '' } })
      await user.click(saveBtn())
      await waitFor(() => expect(bucketOf('날짜 붙일 일')).toBe('inbox'))
      expect(screen.queryByText(t.fieldErrors.date)).toBeNull()
    })

    it('[나중에로] clears date and time and saves as 나중에; hidden once already 나중에', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '미룰 일', date: '2026-03-12', time: '09:00' })
      renderScreen()
      await goTo(user, 'upcoming')
      await openPanel(user, '미룰 일')
      await user.click(within(panel()).getByRole('button', { name: t.detail.moveToSomeday }))
      await waitFor(() => expect(bucketOf('미룰 일')).toBe('someday'))

      await goTo(user, 'someday')
      await openPanel(user, '미룰 일')
      expect(within(panel()).queryByRole('button', { name: t.detail.moveToSomeday })).toBeNull()
    })

    it('editing only the title of a 나중에 task keeps it 나중에; adding a date makes it 예정', async () => {
      const user = userEvent.setup()
      const created = b.t.repo.create({ title: '언젠가 일' })
      b.t.repo.moveToSomeday([created.id])
      renderScreen()
      await goTo(user, 'someday')
      await openPanel(user, '언젠가 일')
      await user.type(within(panel()).getByLabelText(t.detail.titleField), '!')
      await user.click(saveBtn())
      await waitFor(() => expect(bucketOf('언젠가 일!')).toBe('someday'))

      await goTo(user, 'someday')
      await openPanel(user, '언젠가 일!')
      fireEvent.change(within(panel()).getByLabelText(t.detail.date), { target: { value: '2026-03-25' } })
      await user.click(saveBtn())
      await waitFor(() => expect(bucketOf('언젠가 일!')).toBe('scheduled'))
    })

    it('a repeating task shows its repeat and has no [나중에로]', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '반복 일', date: '2026-03-10', repeat: WEEKLY_MONDAY })
      renderScreen()
      await openPanel(user, '반복 일')

      expect(within(panel()).queryByRole('button', { name: t.detail.moveToSomeday })).toBeNull()
      expect((within(panel()).getByLabelText(t.detail.repeat) as HTMLSelectElement).value).toBe('weekly')
      expect(within(panel()).getByRole('button', { name: '월', pressed: true })).toBeTruthy()
    })

    const discardStrip = (): HTMLElement => screen.getByRole('group', { name: ko.home.localCalendar.editDiscardTitle })
    const keepWriting = { name: ko.home.localCalendar.discardNo }
    const discard = { name: ko.home.localCalendar.discardYes }
    const titleOf = (): string => (within(panel()).getByLabelText(t.detail.titleField) as HTMLInputElement).value

    it('Esc asks first when there are unsaved edits; discarding closes without saving', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '그냥 둘 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '그냥 둘 일')

      await user.type(within(panel()).getByLabelText(t.detail.titleField), ' 수정중')
      await user.keyboard('{Escape}')

      expect(discardStrip()).toBeTruthy()
      expect(panel()).toBeTruthy()
      await user.click(within(discardStrip()).getByRole('button', discard))

      expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()
      expect(b.tasks.update).not.toHaveBeenCalled()
    })

    it('Esc closes at once when nothing was edited', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '안 고친 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '안 고친 일')

      await user.click(within(panel()).getByLabelText(t.detail.titleField))
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()
      expect(screen.queryByRole('group', { name: ko.home.localCalendar.editDiscardTitle })).toBeNull()
    })

    it('a data change while editing keeps the typed text', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '바뀌어도 남을 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '바뀌어도 남을 일')
      const input = within(panel()).getByLabelText(t.detail.titleField)
      await user.type(input, ' 수정중')

      const before = b.tasks.list.mock.calls.length
      act(() => notifyDataChanged())
      await waitFor(() => expect(b.tasks.list.mock.calls.length).toBeGreaterThan(before))

      expect(within(panel()).getByLabelText(t.detail.titleField)).toBe(input)
      expect(titleOf()).toBe('바뀌어도 남을 일 수정중')
    })

    it('opening another task while editing asks; keep writing stays, discard moves', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '첫 일', date: '2026-03-10' })
      b.t.repo.create({ title: '둘째 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '첫 일')
      await user.type(within(panel()).getByLabelText(t.detail.titleField), ' 고침')

      await user.click(screen.getByText('둘째 일'))
      expect(discardStrip()).toBeTruthy()
      expect(titleOf()).toBe('첫 일 고침')

      await user.click(within(discardStrip()).getByRole('button', keepWriting))
      expect(screen.queryByRole('group', { name: ko.home.localCalendar.editDiscardTitle })).toBeNull()
      expect(titleOf()).toBe('첫 일 고침')

      await user.click(screen.getByText('둘째 일'))
      await user.click(within(discardStrip()).getByRole('button', discard))
      await waitFor(() => expect(titleOf()).toBe('둘째 일'))
      expect(b.tasks.update).not.toHaveBeenCalled()
    })

    it('opening another task without edits moves at once', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '여기서 나갈 일', date: '2026-03-10' })
      b.t.repo.create({ title: '다음 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '여기서 나갈 일')

      await user.click(screen.getByText('다음 일'))

      await waitFor(() => expect(titleOf()).toBe('다음 일'))
      expect(screen.queryByRole('group', { name: ko.home.localCalendar.editDiscardTitle })).toBeNull()
    })

    it('closing with unsaved edits asks first', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '닫을 때 묻는 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '닫을 때 묻는 일')
      await user.type(within(panel()).getByLabelText(t.detail.titleField), ' 고침')

      await user.click(within(panel()).getByRole('button', { name: t.detail.close }))
      expect(discardStrip()).toBeTruthy()
      await user.click(within(discardStrip()).getByRole('button', keepWriting))
      expect(panel()).toBeTruthy()

      await user.click(within(panel()).getByRole('button', { name: t.detail.close }))
      await user.click(within(discardStrip()).getByRole('button', discard))
      expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()
    })

    it('"닫기" closes it too', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '닫을 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '닫을 일')

      await user.click(within(panel()).getByRole('button', { name: t.detail.close }))

      expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()
    })

    it('delete asks for confirmation first', async () => {
      const user = userEvent.setup()
      const task = b.t.repo.create({ title: '지울 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '지울 일')

      await user.click(within(panel()).getByRole('button', { name: t.detail.remove }))
      const dialog = within(panel()).getByRole('alertdialog')
      expect(within(dialog).getByText(t.detail.confirmRemove)).toBeTruthy()
      expect(b.tasks.remove).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: t.detail.confirmRemoveYes }))

      await waitFor(() => expect(b.tasks.remove).toHaveBeenCalledWith(task.id))
      await waitFor(() => expect(screen.queryByText('지울 일')).toBeNull())
      expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()
      expect(b.t.repo.get(task.id)).toBeUndefined()
    })

    it('Esc in the confirmation cancels only the confirmation', async () => {
      const user = userEvent.setup()
      b.t.repo.create({ title: '안 지울 일', date: '2026-03-10' })
      renderScreen()
      await openPanel(user, '안 지울 일')
      await user.click(within(panel()).getByRole('button', { name: t.detail.remove }))
      within(panel()).getByRole('alertdialog')

      await user.keyboard('{Escape}')
      expect(within(panel()).queryByRole('alertdialog')).toBeNull()
      expect(b.tasks.remove).not.toHaveBeenCalled()
      expect(panel()).toBeTruthy()
    })
  })

  describe('errors', () => {
    it.each([
      ['not_found', t.errors.not_found],
      ['db_unavailable', t.errors.db_unavailable],
      ['internal', t.errors.internal],
      ['invalid_input', t.errors.invalid_input]
    ] as const)('%s shows its own message', async (code, message) => {
      const user = userEvent.setup()
      b.tasks.quickAdd.mockResolvedValueOnce({ ok: false, error: { code } })
      renderScreen()
      await screen.findByText(t.empty.today)

      await user.type(screen.getByLabelText(t.quickInputLabel), '할 일{Enter}')

      expect((await screen.findByRole('alert')).textContent).toContain(message)
    })

    it('an empty-title error from the server explains what to do', async () => {
      b.tasks.quickAdd.mockResolvedValueOnce({ ok: false, error: { code: 'invalid_input', fields: ['title'] } })
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty.today)

      await user.type(screen.getByLabelText(t.quickInputLabel), '할 일{Enter}')

      expect((await screen.findByRole('alert')).textContent).toContain(t.errors.emptyTitle)
    })

    it('not_found also reloads the list', async () => {
      const user = userEvent.setup()
      b.tasks.quickAdd.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } })
      renderScreen()
      await screen.findByText(t.empty.today)
      const before = b.tasks.list.mock.calls.length

      await user.type(screen.getByLabelText(t.quickInputLabel), '할 일{Enter}')

      await waitFor(() => expect(b.tasks.list.mock.calls.length).toBeGreaterThan(before))
    })

    it('keeps the typed text when adding fails', async () => {
      const user = userEvent.setup()
      b.tasks.quickAdd.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      renderScreen()
      await screen.findByText(t.empty.today)
      const input = screen.getByLabelText(t.quickInputLabel) as HTMLInputElement

      await user.type(input, '다시 시도할 글{Enter}')
      await screen.findByRole('alert')

      expect(input.value).toBe('다시 시도할 글')
    })

    it('shows db_unavailable when the lists cannot be loaded, and the message can be dismissed', async () => {
      const user = userEvent.setup()
      b.tasks.list.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
      renderScreen()

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain(t.errors.db_unavailable)

      await user.click(within(alert).getByRole('button', { name: t.errors.dismiss }))
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('empty states', () => {
    it('each view tells what to do next', async () => {
      const user = userEvent.setup()
      renderScreen()

      expect(await screen.findByText(t.empty.today)).toBeTruthy()
      for (const view of ['inbox', 'upcoming', 'someday', 'done'] as const) {
        await goTo(user, view)
        expect(await screen.findByText(t.empty[view])).toBeTruthy()
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.views[view])
      }
    })
  })

  describe('refreshing', () => {
    it('reloads when the window gets focus again', async () => {
      renderScreen()
      await screen.findByText(t.empty.today)
      b.t.repo.create({ title: '밖에서 생긴 일', date: '2026-03-10' })
      const before = b.tasks.list.mock.calls.length

      window.dispatchEvent(new Event('focus'))

      expect(await screen.findByText('밖에서 생긴 일')).toBeTruthy()
      expect(b.tasks.list.mock.calls.length).toBeGreaterThan(before)
    })
  })
})

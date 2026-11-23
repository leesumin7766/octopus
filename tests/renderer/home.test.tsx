// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { defaultLayout, type HomeLayout } from '../../src/shared/home/layout'
import { installBackend, type Backend } from './backend'

const t = ko.home
const TODAY = '2026-03-10' // 화요일

describe('home screen', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  /** 데이터를 먼저 넣고 싶으면 prepare → 데이터 → show 순서로 쓴다. */
  const prepare = (view: 'home' | 'home-arrange' = 'home'): Backend => (b = installBackend(view))
  const show = (): void => void render(<App />)
  const open = (view: 'home' | 'home-arrange' = 'home'): Backend => {
    prepare(view)
    show()
    return b
  }

  const card = async (name: string): Promise<HTMLElement> => screen.findByRole('region', { name })
  const menu = (): HTMLElement => screen.getByRole('navigation', { name: ko.nav.label })
  const arrangeButton = (): HTMLElement => within(menu()).getByRole('button', { name: ko.nav.arrange })
  const colSeparator = (): HTMLElement => screen.getByRole('separator', { name: t.columnSeparator })
  const rowSeparator = (): HTMLElement => screen.getByRole('separator', { name: t.rowSeparator })

  /** 자리 번호 순서대로 본 카드 이름 */
  const slots = (): string[] =>
    [...document.querySelectorAll('section[data-position]')]
      .sort((a, c) => Number(a.getAttribute('data-position')) - Number(c.getAttribute('data-position')))
      .map((el) => el.getAttribute('aria-label') as string)

  const layoutWrites = () => b.settings.set.mock.calls.filter(([key]) => key === 'home.layout')
  const lastLayoutWrite = (): HomeLayout => layoutWrites().at(-1)?.[1] as HomeLayout

  describe('the default screen', () => {
    it('shows today\'s date and the four cards in the default places', async () => {
      open()

      expect(await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })).toBeTruthy()
      await card(t.cards.todo)
      expect(slots()).toEqual([t.cards.todo, t.cards.calendar, t.cards.memo, t.cards.shortcuts])
    })

    it('has a 68px circle button where the two borders meet, inside the card grid, closed at first', async () => {
      open()
      await card(t.cards.todo)

      const circle = await screen.findByRole('button', { name: ko.pie.menuLabel })
      expect(circle.className).toContain('size-[68px]')
      expect(circle.className).toContain('rounded-full')
      expect(circle.getAttribute('aria-expanded')).toBe('false')
      expect(circle.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true') // 인라인 SVG 아이콘
      expect(circle.closest('.grid')).toBe(colSeparator().parentElement) // 두 경계와 같은 격자 안
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('has two focusable separators set to 50% within 25-75', async () => {
      open()
      await card(t.cards.todo)

      for (const separator of [colSeparator(), rowSeparator()]) {
        expect(separator.getAttribute('aria-valuenow')).toBe('50')
        expect(separator.getAttribute('aria-valuemin')).toBe('25')
        expect(separator.getAttribute('aria-valuemax')).toBe('75')
        expect(separator.tabIndex).toBe(0)
      }
      expect(colSeparator().getAttribute('aria-orientation')).toBe('vertical')
      expect(rowSeparator().getAttribute('aria-orientation')).toBe('horizontal')
    })

    it('shows no move arrows outside arrange mode', async () => {
      open()
      await card(t.cards.todo)

      expect(screen.queryByRole('button', { name: /카드를/ })).toBeNull()
    })
  })

  describe('today\'s to-do card', () => {
    it('shows the overdue count line and today\'s tasks, routine items included', async () => {
      const backend = prepare()
      backend.t.repo.create({ title: '밀린 일 하나', date: '2026-03-08' })
      backend.t.repo.create({ title: '밀린 일 둘', date: '2026-03-09' })
      backend.t.repo.create({ title: '보고서 쓰기', date: TODAY, time: '15:00' })
      backend.routineRepo.create({ title: '아침 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
      show()

      const todo = await card(t.cards.todo)
      expect(await within(todo).findByText('보고서 쓰기')).toBeTruthy()
      expect(within(todo).getByText('15:00')).toBeTruthy()
      expect(within(todo).getByRole('button', { name: t.todo.overdue(2) })).toBeTruthy()
      expect(within(todo).queryByText('밀린 일 하나')).toBeNull() // 지난 할 일은 개수만
      const routineRow = within(todo).getByText('아침 스트레칭').closest('li') as HTMLElement
      expect(within(routineRow).getByText(ko.tasks.routineBadge)).toBeTruthy()
    })

    it('shows no overdue line when nothing is overdue, and an empty message with no tasks', async () => {
      open()

      const todo = await card(t.cards.todo)
      expect(await within(todo).findByText(t.todo.empty)).toBeTruthy()
      expect(within(todo).queryByText(/지난 할 일/)).toBeNull()
    })

    it('a routine item whose day passed is not counted as overdue', async () => {
      const backend = prepare()
      const routine = backend.routineRepo.create({ title: '매일 루틴', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
      backend.t.repo.create({ title: '매일 루틴', bucket: 'scheduled', date: '2026-03-09', routineId: routine.id })
      show()

      const todo = await card(t.cards.todo)
      await within(todo).findByText('매일 루틴')
      expect(within(todo).queryByText(/지난 할 일/)).toBeNull()
    })

    it('checking a task completes it and it leaves the list', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const task = backend.t.repo.create({ title: '체크할 일', date: TODAY })
      show()
      const todo = await card(t.cards.todo)

      await user.click(await within(todo).findByRole('checkbox', { name: `${ko.tasks.complete}: 체크할 일` }))

      await waitFor(() => expect(backend.tasks.setStatus).toHaveBeenCalledWith(task.id, 'done'))
      await waitFor(() => expect(within(todo).queryByText('체크할 일')).toBeNull())
      expect(backend.t.repo.get(task.id)?.status).toBe('done')
    })

    it('a routine item can be checked here too', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.routineRepo.create({ title: '아침 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
      show()
      const todo = await card(t.cards.todo)

      await user.click(await within(todo).findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` }))

      await waitFor(() => expect(backend.routineRepo.todayItems(TODAY)[0].status).toBe('done'))
    })

    it('shows an error message when completing fails', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.t.repo.create({ title: '실패할 일', date: TODAY })
      backend.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      show()
      const todo = await card(t.cards.todo)

      await user.click(await within(todo).findByRole('checkbox', { name: `${ko.tasks.complete}: 실패할 일` }))

      expect((await within(todo).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect(within(todo).getByText('실패할 일')).toBeTruthy()
    })

    it('the quick input at the top adds a task for today', async () => {
      const user = userEvent.setup()
      const backend = open()
      const todo = await card(t.cards.todo)
      await within(todo).findByText(t.todo.empty)

      await user.type(within(todo).getByLabelText(ko.tasks.quickInputLabel), '오늘 도서관 책 반납{Enter}')

      await waitFor(() => expect(backend.tasks.quickAdd).toHaveBeenCalledWith('오늘 도서관 책 반납'))
      expect(await within(todo).findByText('도서관 책 반납')).toBeTruthy()
      expect((within(todo).getByLabelText(ko.tasks.quickInputLabel) as HTMLInputElement).value).toBe('')
    })

    it('the quick input shows what was recognized as chips', async () => {
      const user = userEvent.setup()
      open()
      const todo = await card(t.cards.todo)

      await user.type(within(todo).getByLabelText(ko.tasks.quickInputLabel), '내일 오후 3시 보고서 #업무')

      const chips = await within(todo).findByRole('list', { name: ko.tasks.previewLabel })
      await waitFor(() => expect(chips.textContent).toContain('15:00'))
      expect(chips.textContent).toContain('#업무')
    })

    it('"전체 보기" opens the task screen', async () => {
      const user = userEvent.setup()
      open()
      const todo = await card(t.cards.todo)

      await user.click(within(todo).getByRole('button', { name: t.todo.viewAll }))

      expect(await screen.findByRole('heading', { level: 1, name: ko.tasks.views.today })).toBeTruthy()
    })
  })

  describe('today\'s schedule card', () => {
    it('when no calendar is connected it offers an active "connect calendar" button that opens the Arms screen', async () => {
      const user = userEvent.setup()
      open()
      const calendar = await card(t.cards.calendar)

      expect(await within(calendar).findByText(t.calendar.empty)).toBeTruthy()
      const connect = within(calendar).getByRole('button', { name: t.calendar.connect })
      expect(connect.getAttribute('aria-disabled')).toBeNull()
      await user.click(connect)

      expect(await screen.findByRole('heading', { level: 1, name: /Arms/ })).toBeTruthy()
    })
  })

  describe('memo card', () => {
    it('shows pinned memos first and only the latest five, first line only', async () => {
      const backend = prepare()
      for (let i = 1; i <= 7; i++) {
        vi.setSystemTime(new Date(2026, 2, i, 9, 0, 0))
        backend.t.setNow(new Date().toISOString())
        backend.memoRepo.create(`메모 ${i}번\n둘째 줄은 안 보임`)
      }
      backend.memoRepo.togglePin(backend.memoRepo.list().find((m) => m.body.startsWith('메모 1번'))!.id)
      vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
      show()

      const memo = await card(t.cards.memo)
      await within(memo).findByText('메모 1번')
      const rows = within(memo).getAllByRole('listitem').map((li) => li.textContent)
      expect(rows).toEqual([`${ko.memos.pinned}메모 1번`, '메모 7번', '메모 6번', '메모 5번', '메모 4번'])
      expect(within(memo).queryByText(/둘째 줄/)).toBeNull()
      expect(within(memo).queryByText('메모 2번')).toBeNull()
    })

    it('shows memo text as plain text', async () => {
      const backend = prepare()
      backend.memoRepo.create('<img src=x onerror="alert(1)"> <b>굵게</b>')
      show()

      const memo = await card(t.cards.memo)
      await within(memo).findByText((text) => text.includes('굵게'))
      expect(memo.querySelector('img')).toBeNull()
      expect(memo.querySelector('b')).toBeNull()
    })

    it('says so when there are no memos', async () => {
      open()

      expect(await within(await card(t.cards.memo)).findByText(t.memo.empty)).toBeTruthy()
    })

    it('the one-line quick memo saves with Enter and shows up', async () => {
      const user = userEvent.setup()
      const backend = open()
      const memo = await card(t.cards.memo)
      await within(memo).findByText(t.memo.empty)

      await user.type(within(memo).getByLabelText(t.memo.quickLabel), '빵 사 오기{Enter}')

      await waitFor(() => expect(backend.memos.create).toHaveBeenCalledWith('빵 사 오기'))
      expect(await within(memo).findByText('빵 사 오기')).toBeTruthy()
      expect((within(memo).getByLabelText(t.memo.quickLabel) as HTMLInputElement).value).toBe('')
    })

    it('does not save while a Korean character is still being composed, or for blank text', async () => {
      const user = userEvent.setup()
      const backend = open()
      const memo = await card(t.cards.memo)
      const input = within(memo).getByLabelText(t.memo.quickLabel)
      fireEvent.change(input, { target: { value: '한글' } })

      fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
      expect(backend.memos.create).not.toHaveBeenCalled()

      fireEvent.change(input, { target: { value: '   ' } })
      await user.type(input, '{Enter}')
      expect(backend.memos.create).not.toHaveBeenCalled()
    })

    it('"전체 보기" opens the memo screen', async () => {
      const user = userEvent.setup()
      open()
      const memo = await card(t.cards.memo)

      await user.click(within(memo).getByRole('button', { name: t.memo.viewAll }))

      expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()
    })
  })

  describe('shortcuts card', () => {
    it('is an empty state for now', async () => {
      open()

      expect(within(await card(t.cards.shortcuts)).getByText(t.shortcuts.empty)).toBeTruthy()
    })
  })

  describe('arrange mode', () => {
    it('shows a banner and move arrows only where a neighbor exists', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)

      await user.click(arrangeButton())

      expect(screen.getByRole('status').textContent).toContain(t.arranging)
      const arrows = async (name: string) =>
        within(await card(name))
          .queryAllByRole('button', { name: /카드를/ })
          .map((button) => button.getAttribute('aria-label'))
          .sort()
      const label = (name: string, directions: string[]) => directions.map((d) => t.moveLabel(name, d)).sort()

      expect(await arrows(t.cards.todo)).toEqual(label(t.cards.todo, [t.directions.right, t.directions.down]))
      expect(await arrows(t.cards.calendar)).toEqual(label(t.cards.calendar, [t.directions.left, t.directions.down]))
      expect(await arrows(t.cards.memo)).toEqual(label(t.cards.memo, [t.directions.up, t.directions.right]))
      expect(await arrows(t.cards.shortcuts)).toEqual(label(t.cards.shortcuts, [t.directions.up, t.directions.left]))
    })

    it('an arrow swaps the card with that neighbor and saves the layout', async () => {
      const user = userEvent.setup()
      const backend = open()
      await card(t.cards.todo)
      await user.click(arrangeButton())

      await user.click(screen.getByRole('button', { name: t.moveLabel(t.cards.todo, t.directions.right) }))

      expect(slots()).toEqual([t.cards.calendar, t.cards.todo, t.cards.memo, t.cards.shortcuts])
      await waitFor(() => expect(layoutWrites()).toHaveLength(1))
      expect(lastLayoutWrite().order).toEqual(['calendar', 'todo', 'memo', 'shortcuts'])
      expect(backend.settingsRepo.get('home.layout').order).toEqual(['calendar', 'todo', 'memo', 'shortcuts'])
    })

    it('all four directions swap with the right neighbor', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      await user.click(arrangeButton())
      const press = (name: string, direction: string) =>
        user.click(screen.getByRole('button', { name: t.moveLabel(name, direction) }))

      await press(t.cards.todo, t.directions.down) // todo ↔ memo
      expect(slots()).toEqual([t.cards.memo, t.cards.calendar, t.cards.todo, t.cards.shortcuts])
      await press(t.cards.todo, t.directions.right) // todo ↔ shortcuts
      expect(slots()).toEqual([t.cards.memo, t.cards.calendar, t.cards.shortcuts, t.cards.todo])
      await press(t.cards.todo, t.directions.up) // todo ↔ calendar
      expect(slots()).toEqual([t.cards.memo, t.cards.todo, t.cards.shortcuts, t.cards.calendar])
      await press(t.cards.todo, t.directions.left) // todo ↔ memo
      expect(slots()).toEqual([t.cards.todo, t.cards.memo, t.cards.shortcuts, t.cards.calendar])
    })

    it('keeps the new places after a restart', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      await user.click(arrangeButton())
      await user.click(screen.getByRole('button', { name: t.moveLabel(t.cards.memo, t.directions.right) }))
      await waitFor(() => expect(layoutWrites()).toHaveLength(1))
      cleanup()

      show()

      await card(t.cards.todo)
      expect(slots()).toEqual([t.cards.todo, t.cards.calendar, t.cards.shortcuts, t.cards.memo])
    })

    it('"완료" leaves arrange mode (the arrows and banner go away)', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      await user.click(arrangeButton())

      await user.click(within(screen.getByRole('status')).getByRole('button', { name: t.doneArranging }))

      expect(screen.queryByRole('status')).toBeNull()
      expect(arrangeButton().getAttribute('aria-pressed')).toBe('false')
      expect(screen.queryByRole('button', { name: /카드를/ })).toBeNull()
    })

    it('"기본 배치" puts the places and ratios back and saves that', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      await user.click(arrangeButton())
      await user.click(screen.getByRole('button', { name: t.moveLabel(t.cards.todo, t.directions.right) }))
      colSeparator().focus()
      await user.keyboard('{ArrowRight}{ArrowRight}')
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('60')

      await user.click(within(screen.getByRole('status')).getByRole('button', { name: t.resetLayout }))

      expect(slots()).toEqual([t.cards.todo, t.cards.calendar, t.cards.memo, t.cards.shortcuts])
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('50')
      expect(lastLayoutWrite()).toEqual(defaultLayout())
    })

    it('starts in arrange mode with initialView "home-arrange"', async () => {
      open('home-arrange')
      await card(t.cards.todo)

      expect(screen.getByRole('status')).toBeTruthy()
      expect(arrangeButton().getAttribute('aria-pressed')).toBe('true')
    })
  })

  describe('resizing with the separators', () => {
    it('arrow keys move the vertical separator 5% at a time and save', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      colSeparator().focus()

      await user.keyboard('{ArrowRight}')
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('55')
      await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('40')

      expect(layoutWrites()).toHaveLength(4)
      expect(lastLayoutWrite()).toMatchObject({ col: 40, row: 50 })
    })

    it('arrow keys move the horizontal separator, and the other arrows do nothing', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      rowSeparator().focus()

      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(rowSeparator().getAttribute('aria-valuenow')).toBe('60')
      await user.keyboard('{ArrowUp}')
      expect(rowSeparator().getAttribute('aria-valuenow')).toBe('55')
      await user.keyboard('{ArrowLeft}{ArrowRight}')
      expect(rowSeparator().getAttribute('aria-valuenow')).toBe('55')
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('50')
      expect(lastLayoutWrite()).toMatchObject({ col: 50, row: 55 })
    })

    it('stops at 25% and 75%', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      colSeparator().focus()

      await user.keyboard('{ArrowRight>8/}')
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('75')
      await user.keyboard('{ArrowLeft>12/}')
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('25')
    })

    it('a double click puts that border back to 50/50 and saves', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      colSeparator().focus()
      await user.keyboard('{ArrowRight}{ArrowRight}')
      rowSeparator().focus()
      await user.keyboard('{ArrowUp}')
      expect(lastLayoutWrite()).toMatchObject({ col: 60, row: 45 })

      await user.dblClick(colSeparator())

      expect(colSeparator().getAttribute('aria-valuenow')).toBe('50')
      expect(rowSeparator().getAttribute('aria-valuenow')).toBe('45') // 다른 경계는 그대로
      expect(lastLayoutWrite()).toMatchObject({ col: 50, row: 45 })
    })

    it('dragging with the pointer follows it, is limited to 25-75%, and saves once at the end', async () => {
      open()
      await card(t.cards.todo)
      const separator = colSeparator()
      const grid = separator.parentElement as HTMLElement
      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 800, 400))

      fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500, clientY: 200 })
      fireEvent.pointerMove(separator, { pointerId: 1, clientX: 340, clientY: 200 }) // (340-100)/800 = 30%
      expect(separator.getAttribute('aria-valuenow')).toBe('30')
      fireEvent.pointerMove(separator, { pointerId: 1, clientX: 5000, clientY: 200 })
      expect(separator.getAttribute('aria-valuenow')).toBe('75')
      fireEvent.pointerMove(separator, { pointerId: 1, clientX: -300, clientY: 200 })
      expect(separator.getAttribute('aria-valuenow')).toBe('25')
      expect(layoutWrites()).toHaveLength(0) // 끄는 동안에는 저장하지 않는다

      fireEvent.pointerUp(separator, { pointerId: 1, clientX: -300, clientY: 200 })

      expect(layoutWrites()).toHaveLength(1)
      expect(lastLayoutWrite()).toMatchObject({ col: 25, row: 50 })
    })

    it('dragging the horizontal separator uses the vertical position', async () => {
      open()
      await card(t.cards.todo)
      const separator = rowSeparator()
      vi.spyOn(separator.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 800, 400))

      fireEvent.pointerDown(separator, { pointerId: 2, clientX: 500, clientY: 250 })
      fireEvent.pointerMove(separator, { pointerId: 2, clientX: 900, clientY: 130 }) // (130-50)/400 = 20 → 25
      expect(separator.getAttribute('aria-valuenow')).toBe('25')
      fireEvent.pointerMove(separator, { pointerId: 2, clientX: 900, clientY: 290 }) // 60%
      expect(separator.getAttribute('aria-valuenow')).toBe('60')
      fireEvent.pointerUp(separator, { pointerId: 2 })

      expect(lastLayoutWrite()).toMatchObject({ col: 50, row: 60 })
    })

    it('moving the pointer without pressing does not resize', async () => {
      open()
      await card(t.cards.todo)
      const separator = colSeparator()
      vi.spyOn(separator.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))

      fireEvent.pointerMove(separator, { pointerId: 1, clientX: 600 })

      expect(separator.getAttribute('aria-valuenow')).toBe('50')
      expect(layoutWrites()).toHaveLength(0)
    })

    it('a pointer cancel (touch interrupted) also ends the drag and saves', async () => {
      open()
      await card(t.cards.todo)
      const separator = colSeparator()
      vi.spyOn(separator.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 400))

      fireEvent.pointerDown(separator, { pointerId: 3, clientX: 500 })
      fireEvent.pointerMove(separator, { pointerId: 3, clientX: 650 })
      fireEvent.pointerCancel(separator, { pointerId: 3 })
      fireEvent.pointerMove(separator, { pointerId: 3, clientX: 900 }) // 끝난 뒤에는 따라가지 않는다

      expect(separator.getAttribute('aria-valuenow')).toBe('65')
      expect(lastLayoutWrite()).toMatchObject({ col: 65 })
    })

    it('keeps the ratios after a restart', async () => {
      const user = userEvent.setup()
      open()
      await card(t.cards.todo)
      colSeparator().focus()
      await user.keyboard('{ArrowRight}{ArrowRight}')
      rowSeparator().focus()
      await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
      cleanup()

      show()

      await card(t.cards.todo)
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('60')
      expect(rowSeparator().getAttribute('aria-valuenow')).toBe('35')
    })
  })

  describe('saved layouts', () => {
    it('uses a saved layout on start', async () => {
      const backend = prepare()
      backend.settingsRepo.set('home.layout', { version: 1, order: ['memo', 'todo', 'shortcuts', 'calendar'], col: 60, row: 35 })
      show()

      await card(t.cards.todo)
      expect(slots()).toEqual([t.cards.memo, t.cards.todo, t.cards.shortcuts, t.cards.calendar])
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('60')
      expect(rowSeparator().getAttribute('aria-valuenow')).toBe('35')
    })

    it('falls back to the default layout when the saved value is broken', async () => {
      const backend = prepare()
      backend.t.db
        .prepare("INSERT INTO app_meta (key, value) VALUES ('settings.home.layout', ?)")
        .run(JSON.stringify({ version: 1, order: ['todo', 'todo', 'memo', 'shortcuts'], col: 60, row: 35 }))
      show()

      await card(t.cards.todo)
      expect(slots()).toEqual([t.cards.todo, t.cards.calendar, t.cards.memo, t.cards.shortcuts])
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('50')
    })

    it('still works with the default layout when settings cannot be read, and does not crash when saving fails', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.settings.get.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
      backend.settings.set.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
      show()
      await card(t.cards.todo)

      colSeparator().focus()
      await user.keyboard('{ArrowRight}')

      expect(slots()).toEqual([t.cards.todo, t.cards.calendar, t.cards.memo, t.cards.shortcuts])
      expect(colSeparator().getAttribute('aria-valuenow')).toBe('55')
    })
  })
})

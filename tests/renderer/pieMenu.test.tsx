// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { DEFAULT_PIE_SLOTS, shortcutAction, type ActionId } from '../../src/shared/pie/actions'
import { DEAD_ZONE_PX, slotCenterPoint } from '../../src/shared/pie/geometry'
import { installBackend, type Backend } from './backend'

const t = ko.pie
const LABELS = ['지시하기', '할 일 추가', '달력', '할 일 보기', '메모 추가', '체크리스트', '옵시디언', 'Arms']

describe('pie menu', () => {
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

  const prepare = (): Backend => (b = installBackend('home'))
  /** 캘린더 칸(3번째)에 Google 웹 칸을 둔 배치: 연결이 없을 때 사유가 나오는 칸을 검사할 때 쓴다. */
  const prepareWithGoogleAtTwo = (): Backend => {
    const backend = prepare()
    const slots: ActionId[] = [...DEFAULT_PIE_SLOTS]
    slots[2] = 'arm:google-calendar'
    backend.settingsRepo.set('pie.slots', slots)
    return backend
  }

  /** 홈을 띄우고 원 버튼이 보일 때까지 기다린다. */
  async function show(): Promise<HTMLElement> {
    render(<App />)
    const circle = await screen.findByRole('button', { name: t.menuLabel })
    // 원의 가운데를 (500, 300) 으로 정한다. 모든 포인터 좌표는 여기서 잰다.
    vi.spyOn(circle, 'getBoundingClientRect').mockReturnValue(new DOMRect(466, 266, 68, 68))
    return circle
  }

  /** 가운데에서 칸 k 방향으로 radius 만큼 떨어진 포인터 위치 */
  const at = (slot: number, radius = 100) => {
    const { x, y } = slotCenterPoint(slot, radius)
    return { clientX: 500 + x, clientY: 300 + y }
  }
  const CENTER = { clientX: 500, clientY: 300 }
  const wedge = (name: string) => screen.getByRole('menuitem', { name })
  const menu = () => screen.getByRole('menu', { name: t.wedgesLabel })
  const dialog = (name: string) => screen.findByRole('dialog', { name })

  /** 원을 누르고 → 칸 방향으로 끌고 → 놓는다. */
  function drag(circle: HTMLElement, to: { clientX: number; clientY: number }, release = to): void {
    fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })
    fireEvent.pointerMove(circle, { pointerId: 1, ...to })
    fireEvent.pointerUp(circle, { pointerId: 1, ...release })
  }

  describe('press and drag', () => {
    it('pressing opens the eight wedges with their names', async () => {
      prepare()
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })

      expect(circle.getAttribute('aria-expanded')).toBe('true')
      expect(within(menu()).getAllByRole('menuitem').map((el) => el.getAttribute('aria-label'))).toEqual(LABELS)
    })

    it('dragging onto a wedge highlights it, and releasing runs it', async () => {
      prepare()
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })
      fireEvent.pointerMove(circle, { pointerId: 1, ...at(1) })

      expect(wedge('할 일 추가').className).toContain('text-white') // 가리킨 칸 강조
      expect(wedge('달력').className).not.toContain('text-white')

      fireEvent.pointerUp(circle, { pointerId: 1, ...at(1) })

      expect(await dialog(ko.home.dialogs.taskTitle)).toBeTruthy()
      expect(screen.queryByRole('menu')).toBeNull() // 실행하면 메뉴는 닫힌다
    })

    it('every wedge is reachable by dragging in its direction', async () => {
      const backend = prepare()
      // 8칸을 모두 실행할 수 있는 동작으로 바꿔 두고, 칸마다 다른 곳으로 가는지 본다.
      const slots: ActionId[] = ['nav:tasks', 'nav:routines', 'nav:memos', 'nav:settings', 'task:quickAdd', 'memo:quickAdd', 'nav:home', 'nav:tasks']
      backend.settingsRepo.set('pie.slots', slots)
      const expectations: [number, () => Promise<unknown>][] = [
        [0, () => screen.findByRole('heading', { level: 1, name: ko.tasks.views.today })],
        [1, () => screen.findByRole('heading', { level: 1, name: ko.routines.todayTitle })],
        [2, () => screen.findByLabelText(ko.memos.newLabel)],
        [3, () => screen.findByRole('heading', { level: 1, name: ko.settings.title })],
        [4, () => dialog(ko.home.dialogs.taskTitle)],
        [5, () => dialog(ko.home.dialogs.memoTitle)]
      ]

      for (const [slot, expected] of expectations) {
        const circle = await show()
        drag(circle, at(slot))
        expect(await expected(), `slot ${slot}`).toBeTruthy()
        cleanup()
      }
    })

    it('releasing in the dead zone near the center chooses nothing and closes the menu', async () => {
      prepare()
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...at(1) })
      fireEvent.pointerMove(circle, { pointerId: 1, ...at(1) })
      expect(wedge('할 일 추가').className).toContain('text-white')
      fireEvent.pointerMove(circle, { pointerId: 1, clientX: 500 + DEAD_ZONE_PX - 10, clientY: 300 }) // 데드존 안
      expect(wedge('할 일 추가').className).not.toContain('text-white') // 선택이 풀린다
      fireEvent.pointerUp(circle, { pointerId: 1, clientX: 500 + DEAD_ZONE_PX - 10, clientY: 300 })

      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('releasing far outside the menu closes it without running anything', async () => {
      prepare()
      const circle = await show()

      drag(circle, { clientX: 900, clientY: 300 })

      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('a long press without moving closes the menu', async () => {
      prepare()
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })
      vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 1))
      fireEvent.pointerUp(circle, { pointerId: 1, ...CENTER })

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('an interrupted touch (pointer cancel) closes the menu', async () => {
      prepare()
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })
      fireEvent.pointerCancel(circle, { pointerId: 1 })

      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('opens a link shortcut that was put on a wedge', async () => {
      const backend = prepare()
      const link = backend.shortcutRepo.createUrl({ url: 'https://example.com/docs', label: '문서' })
      backend.settingsRepo.set('pie.slots', [...DEFAULT_PIE_SLOTS.slice(0, 7), shortcutAction(link.id)])
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })
      expect(wedge('문서')).toBeTruthy()
      fireEvent.pointerMove(circle, { pointerId: 1, ...at(7) })
      fireEvent.pointerUp(circle, { pointerId: 1, ...at(7) })

      await waitFor(() => expect(backend.shortcuts.open).toHaveBeenCalledWith(link.id))
      expect(backend.platform.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    })
  })

  describe('short press', () => {
    it('opens the menu and keeps it open; a wedge click runs it', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()

      await user.click(circle)

      expect(circle.getAttribute('aria-expanded')).toBe('true')
      expect(menu()).toBeTruthy()

      await user.click(wedge('메모 추가'))

      expect(await dialog(ko.home.dialogs.memoTitle)).toBeTruthy()
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('clicking the circle again closes it', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()

      await user.click(circle)
      await user.click(circle)

      expect(screen.queryByRole('menu')).toBeNull()
      expect(circle.getAttribute('aria-expanded')).toBe('false')
    })

    it('clicking outside closes it', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      await user.click(circle)

      await user.click(screen.getByTestId('pie-backdrop'))

      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.queryByTestId('pie-backdrop')).toBeNull()
    })

    it('Esc closes it and puts the focus back on the circle', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      await user.click(circle)

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(circle)
    })
  })

  describe('wedges that cannot be used yet', () => {
    it('are dimmed and marked aria-disabled; the usable ones are not', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      await user.click(circle)

      for (const name of ['지시하기', '옵시디언']) {
        expect(wedge(name).getAttribute('aria-disabled'), name).toBe('true')
        expect(wedge(name).className).toContain('opacity-50')
      }
      for (const name of ['할 일 추가', '할 일 보기', '메모 추가', '체크리스트', '달력', 'Arms']) expect(wedge(name).getAttribute('aria-disabled'), name).toBeNull()
    })

    it('pointing at one shows why, and the reason goes away when pointing elsewhere', async () => {
      const user = userEvent.setup()
      prepareWithGoogleAtTwo()
      const circle = await show()
      await user.click(circle)
      vi.spyOn(menu(), 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 140, 320, 320))

      fireEvent.pointerMove(menu(), at(2)) // 달력
      expect(within(menu()).getByRole('status').textContent).toBe(t.reasons['arm:google-calendar'])
      fireEvent.pointerMove(menu(), at(0)) // 지시하기
      expect(within(menu()).getByRole('status').textContent).toBe(t.reasons.command)
      fireEvent.pointerMove(menu(), at(1)) // 쓸 수 있는 칸
      expect(within(menu()).getByRole('status').textContent).toBe('')
    })

    it('the reason is also on the wedge title', async () => {
      const user = userEvent.setup()
      prepareWithGoogleAtTwo()
      const circle = await show()
      await user.click(circle)

      expect(wedge('옵시디언').getAttribute('title')).toContain(t.reasons['arm:obsidian'])
      expect(wedge('Google 캘린더').getAttribute('title')).toContain(t.reasons['arm:google-calendar'])
    })

    it('releasing a drag over one does nothing, and the menu stays open so the reason can be read', async () => {
      const backend = prepareWithGoogleAtTwo()
      const circle = await show()

      fireEvent.pointerDown(circle, { pointerId: 1, ...CENTER })
      fireEvent.pointerMove(circle, { pointerId: 1, ...at(2) })
      expect(within(menu()).getByRole('status').textContent).toBe(t.reasons['arm:google-calendar'])
      fireEvent.pointerUp(circle, { pointerId: 1, ...at(2) })

      expect(menu()).toBeTruthy()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(backend.shortcuts.open).not.toHaveBeenCalled()
    })

    it('clicking one does nothing', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      await user.click(circle)

      await user.click(wedge('지시하기'))
      await user.click(wedge('옵시디언'))

      expect(menu()).toBeTruthy()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('a slot that points at a deleted shortcut is dimmed with an explanation', async () => {
      const backend = prepare()
      backend.settingsRepo.set('pie.slots', [...DEFAULT_PIE_SLOTS.slice(0, 7), shortcutAction('01ARZ3NDEKTSV4RRFFQ69G5FAV')])
      const user = userEvent.setup()
      const circle = await show()
      await user.click(circle)

      const gone = wedge(t.deletedShortcut)
      expect(gone.getAttribute('aria-disabled')).toBe('true')
      expect(gone.getAttribute('title')).toContain(t.deletedShortcutReason)
    })
  })

  describe('keyboard', () => {
    it('Enter on the circle opens the menu and focuses the first wedge', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()

      await user.keyboard('{Enter}')

      expect(circle.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(wedge('지시하기'))
    })

    it('Space opens it too', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()

      await user.keyboard(' ')

      expect(menu()).toBeTruthy()
      expect(document.activeElement).toBe(wedge('지시하기'))
    })

    it('arrow keys and Tab / Shift+Tab move between wedges, and wrap around', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}')

      await user.keyboard('{ArrowRight}')
      expect(document.activeElement).toBe(wedge('할 일 추가'))
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(wedge('달력'))
      await user.keyboard('{Tab}')
      expect(document.activeElement).toBe(wedge('할 일 보기'))
      await user.keyboard('{ArrowLeft}{ArrowUp}')
      expect(document.activeElement).toBe(wedge('할 일 추가'))
      await user.keyboard('{Shift>}{Tab}{/Shift}')
      expect(document.activeElement).toBe(wedge('지시하기'))
      await user.keyboard('{ArrowLeft}')
      expect(document.activeElement).toBe(wedge('Arms')) // 첫 칸에서 뒤로 가면 마지막 칸
      await user.keyboard('{ArrowRight}')
      expect(document.activeElement).toBe(wedge('지시하기')) // 마지막에서 앞으로 가면 첫 칸
    })

    it('the focused wedge is highlighted like a pointed one', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}{ArrowRight}')

      expect(wedge('할 일 추가').className).toContain('text-white')
    })

    it('Tab never leaves the menu while it is open', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}')

      await user.keyboard('{Tab}'.repeat(20))

      expect(menu().contains(document.activeElement)).toBe(true)
    })

    it('Enter runs the focused wedge', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}{ArrowRight}')

      await user.keyboard('{Enter}')

      expect(await dialog(ko.home.dialogs.taskTitle)).toBeTruthy()
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('Enter on a wedge that cannot be used does nothing and keeps the menu open', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}') // 첫 칸은 지시하기(준비 중)

      await user.keyboard('{Enter}')

      expect(menu()).toBeTruthy()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(within(menu()).getByRole('status').textContent).toBe(t.reasons.command) // 이유도 보인다
    })

    it('Esc closes the menu and returns the focus to the circle', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}{ArrowRight}{ArrowRight}')

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(circle)
    })

    it('Enter on the circle while the menu is open closes it', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}')
      circle.focus()

      await user.keyboard('{Enter}')

      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  describe('what the wedges do', () => {
    it('"할 일 추가" opens a small dialog with the quick input; Enter adds the task for today and refreshes the card', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const circle = await show()
      drag(circle, at(1))
      const task = await dialog(ko.home.dialogs.taskTitle)

      const input = within(task).getByLabelText(ko.tasks.quickInputLabel)
      expect(document.activeElement).toBe(input)
      await user.type(input, '오늘 우체국 가기{Enter}')

      await waitFor(() => expect(backend.tasks.quickAdd).toHaveBeenCalledWith('오늘 우체국 가기'))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect((await screen.findByRole('status')).textContent).toBe(ko.home.dialogs.taskAdded)
      expect(await within(await screen.findByRole('region', { name: ko.home.cards.todo })).findByText('우체국 가기')).toBeTruthy()
    })

    it('the task dialog shows the recognized parts as chips', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      drag(circle, at(1))
      const task = await dialog(ko.home.dialogs.taskTitle)

      await user.type(within(task).getByLabelText(ko.tasks.quickInputLabel), '내일 오후 3시 보고서')

      const chips = await within(task).findByRole('list', { name: ko.tasks.previewLabel })
      await waitFor(() => expect(chips.textContent).toContain('15:00'))
    })

    it('an error in the task dialog is shown and the dialog stays open', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.tasks.quickAdd.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      const circle = await show()
      drag(circle, at(1))
      const task = await dialog(ko.home.dialogs.taskTitle)

      await user.type(within(task).getByLabelText(ko.tasks.quickInputLabel), '할 일{Enter}')

      expect((await within(task).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect(screen.getByRole('dialog')).toBeTruthy()
    })

    it('"메모" opens a small dialog; Ctrl+Enter saves, and the memo card shows it', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const circle = await show()
      drag(circle, at(4))
      const memo = await dialog(ko.home.dialogs.memoTitle)

      await user.type(within(memo).getByLabelText(ko.home.dialogs.memoLabel), '메모 대화상자에서 쓴 글')
      await user.keyboard('{Control>}{Enter}{/Control}')

      await waitFor(() => expect(backend.memos.create).toHaveBeenCalledWith('메모 대화상자에서 쓴 글'))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect((await screen.findByRole('status')).textContent).toBe(ko.home.dialogs.memoSaved)
      expect(await within(await screen.findByRole('region', { name: ko.home.cards.memo })).findByText('메모 대화상자에서 쓴 글')).toBeTruthy()
    })

    it('the memo dialog does not save blank text or while a Korean character is being composed', async () => {
      const backend = prepare()
      const circle = await show()
      drag(circle, at(4))
      const memo = await dialog(ko.home.dialogs.memoTitle)
      const box = within(memo).getByLabelText(ko.home.dialogs.memoLabel)

      fireEvent.change(box, { target: { value: '   ' } })
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
      fireEvent.change(box, { target: { value: '한글' } })
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true })

      expect(backend.memos.create).not.toHaveBeenCalled()
      expect((within(memo).getByRole('button', { name: ko.home.dialogs.save }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('Esc, the close button and a click on the backdrop close a dialog', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()

      drag(circle, at(1))
      await dialog(ko.home.dialogs.taskTitle)
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()

      drag(circle, at(1))
      const again = await dialog(ko.home.dialogs.taskTitle)
      await user.click(within(again).getByRole('button', { name: ko.home.dialogs.close }))
      expect(screen.queryByRole('dialog')).toBeNull()

      drag(circle, at(4))
      const third = await dialog(ko.home.dialogs.memoTitle)
      await user.click(third.parentElement as HTMLElement)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('after a dialog closes, the focus goes back to where it was', async () => {
      const user = userEvent.setup()
      prepare()
      const circle = await show()
      circle.focus()
      await user.keyboard('{Enter}{ArrowRight}{Enter}')
      await dialog(ko.home.dialogs.taskTitle)

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(circle) // 키보드로 연 곳(원)으로 돌아온다
    })
  })

  describe('custom slots', () => {
    it('uses the eight actions saved in settings, with the right names', async () => {
      const backend = prepare()
      backend.settingsRepo.set('pie.slots', ['nav:settings', 'nav:home', 'nav:tasks', 'nav:routines', 'nav:memos', 'task:quickAdd', 'memo:quickAdd', 'arm:obsidian'])
      const user = userEvent.setup()
      const circle = await show()
      await user.click(circle)

      expect(within(menu()).getAllByRole('menuitem').map((el) => el.getAttribute('aria-label'))).toEqual([
        '설정', '홈', '할 일 보기', '체크리스트', '메모 보기', '할 일 추가', '메모 추가', '옵시디언'
      ])
      expect(wedge('설정').getAttribute('aria-disabled')).toBeNull()
      expect(wedge('옵시디언').getAttribute('aria-disabled')).toBe('true')
    })

    it('falls back to the default eight when the saved value is broken', async () => {
      const backend = prepare()
      backend.t.db
        .prepare("INSERT INTO app_meta (key, value) VALUES ('settings.pie.slots', ?)")
        .run(JSON.stringify(['nav:home', 'rm -rf', 'x', 1, 2, 3, 4, 5]))
      const user = userEvent.setup()
      const circle = await show()
      await user.click(circle)

      expect(within(menu()).getAllByRole('menuitem').map((el) => el.getAttribute('aria-label'))).toEqual(LABELS)
    })
  })
})

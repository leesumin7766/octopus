// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import type { OctopusApi } from '../../src/shared/api'
import { installBackend, type Backend } from './backend'

const TODAY = '2026-03-10' // 화요일
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const n = ko.nav

describe('app shell (left menu)', () => {
  let b: Backend | undefined

  /** 가짜 백엔드를 만든다. 데이터를 먼저 넣고 싶으면 show() 전에 넣는다. */
  function prepare(initialView: OctopusApi['initialView'] = null): Backend {
    b = installBackend(initialView)
    return b
  }

  function show(): void {
    render(<App />)
  }

  function open(initialView: OctopusApi['initialView'] = null): Backend {
    const backend = prepare(initialView)
    show()
    return backend
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    b = undefined
    vi.useRealTimers()
  })

  const menu = (): HTMLElement => screen.getByRole('navigation', { name: n.label })
  const item = (label: string): HTMLElement => within(menu()).getByRole('button', { name: label })
  const heading = (name: string) => screen.findByRole('heading', { level: 1, name })

  describe('starting screen and switching', () => {
    it('starts on the home screen', async () => {
      open()

      expect(await heading('3월 10일 화요일')).toBeTruthy()
      expect(item(n.home).getAttribute('aria-current')).toBe('page')
    })

    it('the menu switches between home, tasks, checklist and memos', async () => {
      const user = userEvent.setup()
      open()
      await heading('3월 10일 화요일')

      await user.click(item(n.tasks))
      expect(await heading(ko.tasks.views.today)).toBeTruthy()
      expect(item(n.tasks).getAttribute('aria-current')).toBe('page')
      expect(item(n.home).getAttribute('aria-current')).toBeNull()

      await user.click(item(n.routines))
      expect(await heading(ko.routines.todayTitle)).toBeTruthy()

      await user.click(item(n.memos))
      expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()

      await user.click(item(n.home))
      expect(await heading('3월 10일 화요일')).toBeTruthy()
    })

    it.each([
      ['routines', ko.routines.todayTitle],
      ['inbox', ko.tasks.views.inbox],
      ['done', ko.tasks.views.done],
      ['today', ko.tasks.views.today],
      ['home', '3월 10일 화요일'],
      ['home-arrange', '3월 10일 화요일']
    ] as const)('initialView %s opens the matching screen', async (initialView, expected) => {
      open(initialView)

      expect(await heading(expected)).toBeTruthy()
    })

    it('initialView memos opens the memo screen', async () => {
      open('memos')

      expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()
    })

    it('the old top tabs are gone', async () => {
      open()
      await heading('3월 10일 화요일')

      expect(screen.queryByRole('tablist')).toBeNull()
      expect(screen.queryByRole('tab')).toBeNull()
    })

    it('a task made on the memo screen shows up on the task screen', async () => {
      const user = userEvent.setup()
      const backend = prepare('memos')
      const memo = backend.memoRepo.create('내일 점심 약속')
      show()

      await user.click(await screen.findByRole('button', { name: ko.memos.toTask }))
      await waitFor(() => expect(backend.memos.toTask).toHaveBeenCalledWith(memo.id))
      await user.click(item(n.tasks))
      await user.click(within(screen.getByRole('navigation', { name: ko.tasks.viewsNavLabel })).getByRole('button', { name: /^예정/ }))

      expect(await screen.findByText('점심 약속')).toBeTruthy()
    })

    it('the home card links go to the task and memo screens', async () => {
      const user = userEvent.setup()
      open()
      await heading('3월 10일 화요일')

      await user.click(within(await screen.findByRole('region', { name: ko.home.cards.todo })).getByRole('button', { name: ko.home.todo.viewAll }))
      expect(await heading(ko.tasks.views.today)).toBeTruthy()
      expect(item(n.tasks).getAttribute('aria-current')).toBe('page')

      await user.click(item(n.home))
      await user.click(within(await screen.findByRole('region', { name: ko.home.cards.memo })).getByRole('button', { name: ko.home.memo.viewAll }))
      expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()
      expect(item(n.memos).getAttribute('aria-current')).toBe('page')
    })
  })

  describe('collapsing the menu', () => {
    it('is expanded at first: icons with names, and the app name', async () => {
      open()
      await heading('3월 10일 화요일')

      expect(within(menu()).getByText(ko.appTitle)).toBeTruthy()
      expect(within(item(n.tasks)).getByText(n.tasks)).toBeTruthy()
      expect(item(n.collapse).getAttribute('aria-expanded')).toBe('true')
    })

    it('☰ folds it to icons only and saves the state; ☰ again expands it', async () => {
      const user = userEvent.setup()
      const backend = open()
      await heading('3월 10일 화요일')

      await user.click(item(n.collapse))

      expect(item(n.expand).getAttribute('aria-expanded')).toBe('false')
      expect(within(menu()).queryByText(ko.appTitle)).toBeNull()
      expect(within(item(n.tasks)).queryByText(n.tasks)).toBeNull() // 이름 글자는 사라지고
      expect(item(n.tasks)).toBeTruthy() // 아이콘 버튼은 이름(aria-label)으로 그대로 찾힌다
      expect(within(item(n.tasks)).getByText((_, el) => el?.tagName.toLowerCase() === 'svg')).toBeTruthy
      await waitFor(() => expect(backend.settings.set).toHaveBeenCalledWith('nav.collapsed', true))
      expect(backend.settingsRepo.get('nav.collapsed')).toBe(true)

      await user.click(item(n.expand))

      expect(item(n.collapse)).toBeTruthy()
      expect(within(menu()).getByText(ko.appTitle)).toBeTruthy()
      await waitFor(() => expect(backend.settings.set).toHaveBeenLastCalledWith('nav.collapsed', false))
    })

    it('comes back folded after a restart', async () => {
      const user = userEvent.setup()
      const backend = open()
      await heading('3월 10일 화요일')
      await user.click(item(n.collapse))
      await waitFor(() => expect(backend.settingsRepo.get('nav.collapsed')).toBe(true))
      cleanup()

      show()

      await heading('3월 10일 화요일')
      expect(item(n.expand)).toBeTruthy()
      expect(within(menu()).queryByText(ko.appTitle)).toBeNull()
    })

    it('starts with the default (collapsed) when a saved value cannot be read (settings unavailable)', async () => {
      const backend = prepare()
      backend.settings.get.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
      show()

      expect(await screen.findByRole('button', { name: n.expand })).toBeTruthy()
    })

    it('every icon-only button keeps its name for screen readers, and icons are inline SVG', async () => {
      const user = userEvent.setup()
      open()
      await heading('3월 10일 화요일')
      await user.click(item(n.collapse))

      for (const button of within(menu()).getAllByRole('button')) {
        expect(button.getAttribute('aria-label')).toBeTruthy()
        const icon = button.querySelector('svg')
        expect(icon).not.toBeNull()
        expect(icon?.getAttribute('aria-hidden')).toBe('true')
        expect(button.textContent).toBe('') // 글자(이모지 포함)가 없다
      }
    })
  })

  describe('Arms menu item', () => {
    it('is active (not "coming soon") and opens the Arms screen', async () => {
      const user = userEvent.setup()
      open()
      await heading('3월 10일 화요일')

      const button = within(menu()).getByRole('button', { name: n.arms })
      expect(button.getAttribute('aria-disabled')).toBeNull()
      await user.click(button)

      expect(await screen.findByRole('heading', { level: 1, name: /Arms/ })).toBeTruthy()
      expect(item(n.arms).getAttribute('aria-current')).toBe('page')
    })
  })

  describe('"화면 배치" button', () => {
    it('is only shown on the home screen, and toggles arrange mode', async () => {
      const user = userEvent.setup()
      open()
      await heading('3월 10일 화요일')
      const arrange = item(n.arrange) as HTMLButtonElement
      expect(arrange.disabled).toBe(false)
      expect(arrange.getAttribute('aria-pressed')).toBe('false')

      await user.click(arrange)
      expect(arrange.getAttribute('aria-pressed')).toBe('true')
      expect(await screen.findByRole('status')).toBeTruthy()

      await user.click(arrange)
      expect(arrange.getAttribute('aria-pressed')).toBe('false')

      await user.click(item(n.tasks))
      expect(within(menu()).queryByRole('button', { name: n.arrange })).toBeNull()
    })

    it('leaving the home screen turns arrange mode off', async () => {
      const user = userEvent.setup()
      open()
      await heading('3월 10일 화요일')
      await user.click(item(n.arrange))

      await user.click(item(n.tasks))
      await user.click(item(n.home))

      expect((item(n.arrange) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  describe('routine items in the task views', () => {
    it("shows today's routine items in the today view with a small 루틴 badge", async () => {
      const backend = prepare('today')
      backend.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      backend.t.repo.create({ title: '일반 할 일', date: TODAY })
      show()

      const routineRow = (await screen.findByText('아침 스트레칭')).closest('li') as HTMLElement
      expect(within(routineRow).getByText(ko.tasks.routineBadge)).toBeTruthy()
      const plainRow = screen.getByText('일반 할 일').closest('li') as HTMLElement
      expect(within(plainRow).queryByText(ko.tasks.routineBadge)).toBeNull()
    })

    it("the today view makes today's routine items by itself when the app was opened on a new day", async () => {
      const backend = prepare('today')
      backend.routineRepo.create({ title: '어제 만든 루틴', days: EVERY_DAY }, '2026-03-09')
      expect(backend.routineRepo.todayItems(TODAY)).toEqual([])
      show()

      expect(await screen.findByText('어제 만든 루틴')).toBeTruthy()
    })

    it('an unfinished routine item from a past day is not in "지난 할 일"', async () => {
      const backend = prepare('today')
      const routine = backend.routineRepo.create({ title: '어제 못 한 루틴', days: EVERY_DAY }, TODAY)
      backend.t.repo.create({ title: '어제 못 한 루틴', bucket: 'scheduled', date: '2026-03-09', routineId: routine.id })
      backend.t.repo.create({ title: '밀린 일반 할 일', date: '2026-03-09' })
      show()

      const overdue = await screen.findByRole('region', { name: ko.tasks.overdue.title })
      expect(within(overdue).getByText('밀린 일반 할 일')).toBeTruthy()
      expect(within(overdue).queryByText('어제 못 한 루틴')).toBeNull()
      expect(within(overdue).getAllByRole('checkbox', { name: new RegExp(`^${ko.tasks.complete}`) })).toHaveLength(1)
    })

    it('with only a past routine item, there is no "지난 할 일" section at all', async () => {
      const backend = prepare('today')
      const routine = backend.routineRepo.create({ title: '어제 못 한 루틴', days: EVERY_DAY }, TODAY)
      backend.t.repo.create({ title: '어제 못 한 루틴', bucket: 'scheduled', date: '2026-03-09', routineId: routine.id })
      show()
      await screen.findByText('어제 못 한 루틴')

      expect(screen.queryByRole('region', { name: ko.tasks.overdue.title })).toBeNull()
    })

    it('checking a routine item in the today view completes it, and the checklist screen agrees', async () => {
      const user = userEvent.setup()
      const backend = prepare('today')
      backend.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      show()

      await user.click(await screen.findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` }))
      await waitFor(() => expect(backend.routineRepo.todayItems(TODAY)[0].status).toBe('done'))
      await user.click(item(n.routines))

      const checkbox = (await screen.findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` })) as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })
  })

  describe('task detail', () => {
    it('a routine item has its date and bucket locked, with a reason, and cannot be deleted', async () => {
      const user = userEvent.setup()
      const backend = prepare('today')
      backend.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      show()

      await user.click(await screen.findByText('아침 스트레칭'))

      const panel = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
      expect((within(panel).getByLabelText(ko.tasks.detail.date) as HTMLInputElement).disabled).toBe(true)
      expect(within(panel).getByText(ko.tasks.detail.routineLocksDate)).toBeTruthy()
      expect(within(panel).queryByRole('button', { name: ko.tasks.detail.remove })).toBeNull()
    })

    it('an ordinary task keeps its date editable', async () => {
      const user = userEvent.setup()
      const backend = prepare('today')
      backend.t.repo.create({ title: '일반 할 일', date: TODAY })
      show()

      await user.click(await screen.findByText('일반 할 일'))

      const panel = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
      expect((within(panel).getByLabelText(ko.tasks.detail.date) as HTMLInputElement).disabled).toBe(false)
    })

    it('shows the memo a task was made from, as plain text', async () => {
      const user = userEvent.setup()
      const backend = prepare('today')
      const memo = backend.memoRepo.create('오늘 치과 예약 전화\n<b>번호</b>: 02-000-0000\n두 번째 줄')
      const { task } = backend.memoRepo.toTask(memo.id, TODAY)
      show()

      await user.click(await screen.findByText(task.title))

      const section = await screen.findByRole('region', { name: ko.tasks.detail.linkedMemo })
      const text = within(section).getByText((content) => content.includes('02-000-0000'))
      expect(text.textContent).toBe(memo.body)
      expect(section.querySelector('b')).toBeNull()
      expect(text.className).toContain('whitespace-pre-wrap')
    })

    it('shows no linked-memo section for a task without a memo', async () => {
      const user = userEvent.setup()
      const backend = prepare('today')
      backend.t.repo.create({ title: '메모 없는 할 일', date: TODAY })
      show()

      await user.click(await screen.findByText('메모 없는 할 일'))
      await screen.findByRole('complementary', { name: ko.tasks.detail.title })

      expect(screen.queryByRole('region', { name: ko.tasks.detail.linkedMemo })).toBeNull()
    })
  })
})

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

describe('app (tabs)', () => {
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

  const tab = (name: keyof typeof ko.tabs) => screen.getByRole('tab', { name: ko.tabs[name] as string })

  describe('switching screens', () => {
    it('starts on the task screen (today view) and switches with the tabs', async () => {
      const user = userEvent.setup()
      open()

      expect(tab('tasks').getAttribute('aria-selected')).toBe('true')
      expect(await screen.findByRole('heading', { level: 1, name: ko.tasks.views.today })).toBeTruthy()

      await user.click(tab('routines'))
      expect(tab('routines').getAttribute('aria-selected')).toBe('true')
      expect(await screen.findByRole('heading', { level: 1, name: ko.routines.todayTitle })).toBeTruthy()

      await user.click(tab('memos'))
      expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()

      await user.click(tab('tasks'))
      expect(await screen.findByRole('heading', { level: 1, name: ko.tasks.views.today })).toBeTruthy()
    })

    it.each([
      ['routines', ko.routines.todayTitle],
      ['memos', ko.memos.newLabel],
      ['inbox', ko.tasks.views.inbox],
      ['done', ko.tasks.views.done]
    ] as const)('initialView %s opens the matching screen', async (initialView, expected) => {
      open(initialView)

      if (initialView === 'memos') expect(await screen.findByLabelText(expected)).toBeTruthy()
      else expect(await screen.findByRole('heading', { level: 1, name: expected })).toBeTruthy()
    })

    it('a task made on the memo screen shows up on the task screen', async () => {
      const user = userEvent.setup()
      const backend = prepare('memos')
      const memo = backend.memoRepo.create('내일 점심 약속')
      show()

      await user.click(await screen.findByRole('button', { name: ko.memos.toTask }))
      await waitFor(() => expect(backend.memos.toTask).toHaveBeenCalledWith(memo.id))
      await user.click(tab('tasks'))
      await user.click(within(screen.getByRole('navigation', { name: ko.tasks.viewsNavLabel })).getByRole('button', { name: /^예정/ }))

      expect(await screen.findByText('점심 약속')).toBeTruthy()
    })
  })

  describe('routine items in the task views', () => {
    it("shows today's routine items in the today view with a small 루틴 badge", async () => {
      const backend = prepare()
      backend.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      backend.t.repo.create({ title: '일반 할 일', date: TODAY })
      show()

      const routineRow = (await screen.findByText('아침 스트레칭')).closest('li') as HTMLElement
      expect(within(routineRow).getByText(ko.tasks.routineBadge)).toBeTruthy()
      const plainRow = screen.getByText('일반 할 일').closest('li') as HTMLElement
      expect(within(plainRow).queryByText(ko.tasks.routineBadge)).toBeNull()
    })

    it('the today view makes today\'s routine items by itself when the app was opened on a new day', async () => {
      const backend = prepare()
      backend.routineRepo.create({ title: '어제 만든 루틴', days: EVERY_DAY }, '2026-03-09')
      expect(backend.routineRepo.todayItems(TODAY)).toEqual([])
      show()

      expect(await screen.findByText('어제 만든 루틴')).toBeTruthy()
    })

    it('an unfinished routine item from a past day is not in "지난 할 일"', async () => {
      const backend = prepare()
      const routine = backend.routineRepo.create({ title: '어제 못 한 루틴', days: EVERY_DAY }, TODAY)
      backend.t.repo.create({ title: '어제 못 한 루틴', bucket: 'scheduled', date: '2026-03-09', routineId: routine.id })
      backend.t.repo.create({ title: '밀린 일반 할 일', date: '2026-03-09' })
      show()

      const overdue = await screen.findByRole('region', { name: ko.tasks.overdue.title })
      expect(within(overdue).getByText('밀린 일반 할 일')).toBeTruthy()
      expect(within(overdue).queryByText('어제 못 한 루틴')).toBeNull()
      expect(within(overdue).getAllByRole('checkbox', { name: new RegExp(`^${ko.tasks.select}`) })).toHaveLength(1)
    })

    it('with only a past routine item, there is no "지난 할 일" section at all', async () => {
      const backend = prepare()
      const routine = backend.routineRepo.create({ title: '어제 못 한 루틴', days: EVERY_DAY }, TODAY)
      backend.t.repo.create({ title: '어제 못 한 루틴', bucket: 'scheduled', date: '2026-03-09', routineId: routine.id })
      show()
      await screen.findByText('어제 못 한 루틴')

      expect(screen.queryByRole('region', { name: ko.tasks.overdue.title })).toBeNull()
    })

    it('checking a routine item in the today view completes it, and the checklist screen agrees', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      show()

      await user.click(await screen.findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` }))
      await waitFor(() => expect(backend.routineRepo.todayItems(TODAY)[0].status).toBe('done'))
      await user.click(tab('routines'))

      const checkbox = (await screen.findByRole('checkbox', { name: `${ko.tasks.complete}: 아침 스트레칭` })) as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })
  })

  describe('task detail', () => {
    it('a routine item has its date and bucket locked, with a reason', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.routineRepo.create({ title: '아침 스트레칭', days: EVERY_DAY }, TODAY)
      show()

      await user.click(await screen.findByText('아침 스트레칭'))

      const panel = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
      expect((within(panel).getByLabelText(ko.tasks.detail.date) as HTMLInputElement).disabled).toBe(true)
      expect((within(panel).getByLabelText(ko.tasks.detail.bucket) as HTMLSelectElement).disabled).toBe(true)
      expect(within(panel).getByText(ko.tasks.detail.routineLocksDate)).toBeTruthy()
    })

    it('an ordinary task keeps its date and bucket editable', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.t.repo.create({ title: '일반 할 일', date: TODAY })
      show()

      await user.click(await screen.findByText('일반 할 일'))

      const panel = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
      expect((within(panel).getByLabelText(ko.tasks.detail.date) as HTMLInputElement).disabled).toBe(false)
      expect((within(panel).getByLabelText(ko.tasks.detail.bucket) as HTMLSelectElement).disabled).toBe(false)
    })

    it('shows the memo a task was made from, as plain text', async () => {
      const user = userEvent.setup()
      const backend = prepare()
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
      const backend = prepare()
      backend.t.repo.create({ title: '메모 없는 할 일', date: TODAY })
      show()

      await user.click(await screen.findByText('메모 없는 할 일'))
      await screen.findByRole('complementary', { name: ko.tasks.detail.title })

      expect(screen.queryByRole('region', { name: ko.tasks.detail.linkedMemo })).toBeNull()
    })
  })
})

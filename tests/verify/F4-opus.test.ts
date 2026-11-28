// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// F4 독립 검증(Opus): 홈 할 일 제목 → 상세, 홈 메모 → 그 메모 편집, 메모 → 할 일로 만들기 → [보기] → 그 할 일. 모두 쓰던 내용이 있으면 먼저 묻는다.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

const t = ko.tasks
const mm = ko.memos
const m = ko.home.localCalendar
const TODAY = '2026-03-10'

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

let b: Backend
let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  b = installBackend('home')
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

const todo = (): Promise<HTMLElement> => screen.findByRole('region', { name: ko.home.cards.todo })
const memoCard = (): Promise<HTMLElement> => screen.findByRole('region', { name: ko.home.cards.memo })
const detail = (): HTMLElement | null => screen.queryByRole('complementary', { name: t.detail.title })
const detailTitle = (): string => (within(detail()!).getByLabelText(t.detail.titleField) as HTMLInputElement).value
const editBox = (): HTMLTextAreaElement | null => screen.queryByLabelText(mm.editLabel) as HTMLTextAreaElement | null

describe('F4 (Opus) home → task detail', () => {
  it('keyboard: focusing the title and pressing Enter opens the detail once', async () => {
    b.t.repo.create({ title: '키보드로 열 일', date: TODAY })
    render(createElement(App))
    const c = await todo()
    const title = await within(c).findByRole('button', { name: '키보드로 열 일' })
    title.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(detail()).not.toBeNull())
    expect(detailTitle()).toBe('키보드로 열 일')
    expect(screen.getByRole('heading', { level: 1, name: t.views.today })).toBeTruthy()
  })

  it('an overdue task on the card opens in the today view (where overdue lives)', async () => {
    b.t.repo.create({ title: '어제 못 한 일', date: '2026-03-09' })
    b.t.repo.create({ title: '오늘 할 것', date: TODAY })
    render(createElement(App))
    const c = await todo()
    await user.click(await within(c).findByRole('button', { name: '오늘 할 것' }))
    await waitFor(() => expect(detail()).not.toBeNull())
    expect(detailTitle()).toBe('오늘 할 것')
  })

  it('the checkbox still only completes; it does not open the detail', async () => {
    b.t.repo.create({ title: '체크만 할 것', date: TODAY })
    render(createElement(App))
    const c = await todo()
    await user.click(await within(c).findByRole('checkbox', { name: `${t.complete}: 체크만 할 것` }))
    await within(c).findByRole('status')
    expect(detail()).toBeNull()
    expect(screen.getByRole('region', { name: ko.home.cards.todo })).toBeTruthy()
  })
})

describe('F4 (Opus) home → memo', () => {
  it('clicking a memo opens the memo screen with that memo in edit mode', async () => {
    b.memoRepo.create('첫 메모')
    const target = b.memoRepo.create('열 메모\n둘째 줄')
    render(createElement(App))
    const c = await memoCard()
    await user.click(await within(c).findByRole('button', { name: '열 메모' }))
    await waitFor(() => expect(editBox()).not.toBeNull())
    expect(editBox()!.value).toBe('열 메모\n둘째 줄')
    expect(document.querySelector(`[data-memo-id="${target.id}"]`)?.className).toContain('ring')
  })

  it('the highlight goes away after ~3s even if the memo list reloads in between', async () => {
    const target = b.memoRepo.create('강조될 메모')
    render(createElement(App))
    await user.click(await within(await memoCard()).findByRole('button', { name: '강조될 메모' }))
    await waitFor(() => expect(editBox()).not.toBeNull())
    const row = (): Element | null => document.querySelector(`[data-memo-id="${target.id}"]`)
    expect(row()?.className).toContain('ring-2')
    // 창이 다시 포커스를 받으면 메모 목록을 다시 읽는다.
    await act(async () => void fireEvent.focus(window))
    await waitFor(() => expect(b.memos.list.mock.calls.length).toBeGreaterThan(1))
    await act(async () => void vi.advanceTimersByTime(3500))
    expect(row()?.className ?? '').not.toContain('ring-2')
  })

  it('with a draft in the home task input, clicking a memo asks first; 계속 쓰기 keeps everything', async () => {
    b.memoRepo.create('묻고 열 메모')
    render(createElement(App))
    const c = await todo()
    await user.type(within(c).getByLabelText(t.quickInputLabel), '쓰던 할 일')
    await user.click(await within(await memoCard()).findByRole('button', { name: '묻고 열 메모' }))
    await user.click(await screen.findByRole('button', { name: m.discardNo }))
    expect((within(await todo()).getByLabelText(t.quickInputLabel) as HTMLInputElement).value).toBe('쓰던 할 일')
    expect(editBox()).toBeNull()
  })
})

describe('F4 (Opus) memo → task → [보기]', () => {
  async function openMemos() {
    render(createElement(App))
    await todo()
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.memos }))
    return screen.findByRole('region', { name: mm.listLabel })
  }

  it('makes the task, shows the notice, and [보기] selects that exact task', async () => {
    b.memoRepo.create('내일 회의 준비')
    const list = await openMemos()
    await user.click(await within(list).findByRole('button', { name: mm.toTask }))
    await user.click(await screen.findByRole('button', { name: mm.madeTaskView }))
    await waitFor(() => expect(detail()).not.toBeNull())
    expect(detailTitle()).toBe('회의 준비')
    expect(screen.getByRole('heading', { level: 1, name: t.views.upcoming })).toBeTruthy()
  })

  it('[보기] while a new-memo draft is written asks first; 계속 쓰기 stays on memos with the draft', async () => {
    b.memoRepo.create('보고서 쓰기')
    const list = await openMemos()
    await user.click(await within(list).findByRole('button', { name: mm.toTask }))
    await screen.findByRole('button', { name: mm.madeTaskView })
    const draft = screen.getByLabelText(mm.newLabel) as HTMLTextAreaElement
    await user.type(draft, '새로 쓰는 메모')
    await user.click(screen.getByRole('button', { name: mm.madeTaskView }))
    await user.click(await screen.findByRole('button', { name: m.discardNo }))
    expect((screen.getByLabelText(mm.newLabel) as HTMLTextAreaElement).value).toBe('새로 쓰는 메모')
    expect(detail()).toBeNull()
  })

  it('a failed 할 일로 만들기 shows no [보기]', async () => {
    b.memoRepo.create('실패할 메모')
    const list = await openMemos()
    b.memos.toTask.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    await user.click(await within(list).findByRole('button', { name: mm.toTask }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: mm.madeTaskView })).toBeNull()
  })
})

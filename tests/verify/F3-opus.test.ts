// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// F3 독립 검증(Opus): 지금 목록에 안 보이는 곳에 추가하면 안내 + [보기]. [보기]는 그 할 일이 보이는 보기에서 선택해 연다.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { viewOf } from '../../src/shared/tasks/viewOf'
import { installBackend, type Backend } from '../renderer/backend'

const t = ko.tasks
const m = ko.home.localCalendar
const TODAY = '2026-03-10'

describe('F3 (Opus) viewOf', () => {
  it('maps every status/bucket/date combination to the view that shows it', () => {
    expect(viewOf({ status: 'done', bucket: 'scheduled', date: '2026-04-01' }, TODAY)).toBe('done')
    expect(viewOf({ status: 'canceled', bucket: 'inbox', date: null }, TODAY)).toBe('done')
    expect(viewOf({ status: 'open', bucket: 'someday', date: null }, TODAY)).toBe('someday')
    expect(viewOf({ status: 'open', bucket: 'inbox', date: null }, TODAY)).toBe('inbox')
    expect(viewOf({ status: 'open', bucket: 'scheduled', date: TODAY }, TODAY)).toBe('today')
    expect(viewOf({ status: 'open', bucket: 'scheduled', date: '2026-03-01' }, TODAY)).toBe('today') // 지난 할 일은 오늘 보기에 있다
    expect(viewOf({ status: 'open', bucket: 'scheduled', date: '2026-03-11' }, TODAY)).toBe('upcoming')
    expect(viewOf({ status: 'open', bucket: 'scheduled', date: '2027-01-01' }, '2026-12-31')).toBe('upcoming')
  })
})

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

describe('F3 (Opus) notice and [보기]', () => {
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

  const card = (): Promise<HTMLElement> => screen.findByRole('region', { name: ko.home.cards.todo })
  const input = (c: HTMLElement): HTMLInputElement => within(c).getByLabelText(t.quickInputLabel) as HTMLInputElement
  const detail = (): HTMLElement | null => screen.queryByRole('complementary', { name: t.detail.title })
  const detailTitle = (): string => (within(detail()!).getByLabelText(t.detail.titleField) as HTMLInputElement).value
  const nav = (name: string) => user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name }))

  async function addOnHome(text: string): Promise<HTMLElement> {
    render(createElement(App))
    const c = await card()
    await user.type(input(c), `${text}{Enter}`)
    return c
  }

  it('the notice disappears on its own after about 6 seconds', async () => {
    const c = await addOnHome('보고서')
    expect(await within(c).findByText(t.added.inbox)).toBeTruthy()
    await act(async () => void vi.advanceTimersByTime(6100))
    expect(within(c).queryByText(t.added.inbox)).toBeNull()
  })

  it('a failed add shows no notice and keeps the text', async () => {
    render(createElement(App))
    const c = await card()
    b.tasks.quickAdd.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    await user.type(input(c), '보고서{Enter}')
    expect(await within(c).findByRole('alert')).toBeTruthy()
    expect(within(c).queryByText(t.added.inbox)).toBeNull()
    expect(input(c).value).toBe('보고서')
  })

  it('[보기] with a draft in the home input: asks first; 계속 쓰기 stays home with the draft', async () => {
    const c = await addOnHome('보고서')
    await within(c).findByText(t.added.inbox)
    await user.type(input(c), '쓰던 글')
    await user.click(within(c).getByRole('button', { name: t.added.view }))
    await user.click(await screen.findByRole('button', { name: m.discardNo }))
    expect(screen.getByRole('region', { name: ko.home.cards.todo })).toBeTruthy()
    expect(input(screen.getByRole('region', { name: ko.home.cards.todo })).value).toBe('쓰던 글')
    expect(detail()).toBeNull()
  })

  it('[보기] with a draft: 버리기 opens the task in its view', async () => {
    const c = await addOnHome('내일 보고서')
    await within(c).findByText(t.added.on('내일'))
    await user.type(input(c), '쓰던 글')
    await user.click(within(c).getByRole('button', { name: t.added.view }))
    await user.click(await screen.findByRole('button', { name: m.discardYes }))
    await waitFor(() => expect(detail()).not.toBeNull())
    expect(detailTitle()).toBe('보고서')
    expect(screen.getByRole('heading', { level: 1, name: t.views.upcoming })).toBeTruthy()
  })

  it('an old [보기] request does not run again when the tasks screen is opened from the menu later', async () => {
    const c = await addOnHome('보고서')
    await user.click(await within(c).findByRole('button', { name: t.added.view }))
    await waitFor(() => expect(detail()).not.toBeNull())
    await nav(ko.nav.home)
    await card()
    await nav(ko.nav.tasks)
    await screen.findByRole('heading', { level: 1 })
    expect(detail()).toBeNull()
  })

  it('a task already visible on the home card ("3시 보고서") gives no notice', async () => {
    const c = await addOnHome('3시 보고서')
    await within(c).findByText('보고서')
    expect(within(c).queryByText(t.added.inbox)).toBeNull()
    expect(within(c).queryByRole('button', { name: t.added.view })).toBeNull()
  })

  it('the add notice and the undo notice never show together on the home card', async () => {
    b.t.repo.create({ title: '체크할 것', date: TODAY })
    const c = await addOnHome('보고서')
    await within(c).findByText(t.added.inbox)
    await user.click(await within(c).findByRole('checkbox', { name: `${t.complete}: 체크할 것` }))
    await waitFor(() => expect(within(c).getAllByRole('status')).toHaveLength(1))
    expect(within(c).queryByText(t.added.inbox)).toBeNull()
  })

  it('tasks tab: adding into the current view gives no notice; adding elsewhere does, and [보기] switches view and selects', async () => {
    render(createElement(App))
    await card()
    await nav(ko.nav.tasks)
    const box = await screen.findByLabelText(t.quickInputLabel)
    await user.type(box, '오늘 점검{Enter}')
    await waitFor(() => expect(screen.getByText('점검')).toBeTruthy())
    expect(screen.queryByRole('button', { name: t.added.view })).toBeNull()

    await user.type(box, '다음주 월 회의{Enter}')
    await user.click(await screen.findByRole('button', { name: t.added.view }))
    await waitFor(() => expect(detail()).not.toBeNull())
    expect(detailTitle()).toBe('회의')
    expect(screen.getByRole('heading', { level: 1, name: t.views.upcoming })).toBeTruthy()
  })
})

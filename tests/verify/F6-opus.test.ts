// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// F6 독립 검증(Opus): 할 일 탭 검색. 새 요청 없이 읽어 둔 목록에서 찾고, 특수 문자·HTML 같은 제목도 안전하고, 목록이 바뀌면 결과도 바뀐다.
import { createElement, type ComponentType } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

const TODAY = '2026-11-26'
const t = ko.tasks

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

let b: Backend
let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  b = installBackend('home')
  user = userEvent.setup()
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

const searchBox = (): HTMLInputElement => screen.getByLabelText(t.search.label) as HTMLInputElement
const results = (): Promise<HTMLElement> => screen.findByRole('region', { name: t.search.title })

async function openTasks(): Promise<void> {
  render(createElement(App))
  await screen.findByRole('region', { name: ko.home.cards.todo })
  await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.tasks }))
  await screen.findByRole('heading', { level: 1, name: t.views.today })
}

describe('F6 (Opus)', () => {
  it('searching sends no new list requests', async () => {
    b.t.repo.create({ title: '보고서 초안', date: TODAY })
    await openTasks()
    const calls = b.tasks.list.mock.calls.length + b.tasks.listCanceled.mock.calls.length
    await user.type(searchBox(), '보고')
    await within(await results()).findByRole('button', { name: new RegExp('보고서 초안') })
    expect(b.tasks.list.mock.calls.length + b.tasks.listCanceled.mock.calls.length).toBe(calls)
  })

  it('an overdue task is found under 오늘 and opens there', async () => {
    b.t.repo.create({ title: '밀린 정산', date: '2026-11-20' })
    await openTasks()
    await user.click(within(screen.getByRole('navigation', { name: t.viewsNavLabel })).getByRole('button', { name: new RegExp(t.views.inbox) }))
    await user.type(searchBox(), '정산')
    const hit = await within(await results()).findByRole('button', { name: new RegExp('밀린 정산') })
    expect(hit.getAttribute('aria-label') ?? hit.textContent).toContain(t.views.today)
    await user.click(hit)
    await waitFor(() => expect(screen.getByRole('complementary', { name: t.detail.title })).toBeTruthy())
    expect(screen.getByRole('heading', { level: 1, name: t.views.today })).toBeTruthy()
  })

  it('special characters and HTML-like titles are matched as plain text and never rendered as markup', async () => {
    b.t.repo.create({ title: '<b>굵게</b> (a+b) 계산', date: TODAY })
    await openTasks()
    await user.type(searchBox(), '(a+b)')
    const hit = await within(await results()).findByRole('button', { name: /계산/ })
    expect(hit.querySelector('b')).toBeNull()
    expect(hit.textContent).toContain('<b>굵게</b>')
    expect(hit.querySelector('mark')?.textContent).toBe('(a+b)')
  })

  it('results follow list changes: a task completed during the search moves to 완료', async () => {
    const task = b.t.repo.create({ title: '움직일 점검', date: TODAY })
    await openTasks()
    await user.type(searchBox(), '점검')
    const groupOf = async (): Promise<string> => {
      const hit = await within(await results()).findByRole('button', { name: /움직일 점검/ })
      return hit.getAttribute('aria-label') ?? hit.textContent ?? ''
    }
    expect(await groupOf()).toContain(t.views.today)
    b.t.repo.setStatus(task.id, 'done')
    window.dispatchEvent(new Event('focus'))
    await waitFor(async () => expect(await groupOf()).toContain(t.views.done))
  })

  it('the view chosen before searching is kept while searching and after Esc', async () => {
    b.t.repo.create({ title: '수신 메모거리' })
    await openTasks()
    await user.click(within(screen.getByRole('navigation', { name: t.viewsNavLabel })).getByRole('button', { name: new RegExp(t.views.someday) }))
    await user.type(searchBox(), '메모거리')
    await within(await results()).findByRole('button', { name: /수신 메모거리/ })
    await user.keyboard('{Escape}')
    expect(searchBox().value).toBe('')
    expect(screen.getByRole('heading', { level: 1, name: t.views.someday })).toBeTruthy()
  })
})

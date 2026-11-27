// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// P3 독립 검증(Opus): 홈 '오늘 할 일' 카드 체크 되돌리기.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

let App: ComponentType
beforeAll(async () => {
  const a = '../../src/renderer/App'
  App = (await import(a)).App
})

const TODAY = '2026-03-10'
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
const box = (c: HTMLElement, title: string) => within(c).findByRole('checkbox', { name: `${ko.tasks.complete}: ${title}` })
const notice = (c: HTMLElement): HTMLElement | null => within(c).queryByRole('status')

describe('P3 (Opus)', () => {
  it('undo of a repeating task leaves exactly one open copy (no extra next occurrence)', async () => {
    b.t.repo.create({ title: '매일 할 일', date: TODAY, repeat: { freq: 'daily', interval: 1 } })
    render(createElement(App))
    const c = await card()
    await user.click(await box(c, '매일 할 일'))
    await within(c).findByRole('status')
    await user.click(within(notice(c)!).getByRole('button', { name: ko.tasks.undo.button }))
    await waitFor(() => expect(b.t.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'").get()).toEqual({ n: 1 }))
    expect(((await box(c, '매일 할 일')) as HTMLInputElement).checked).toBe(false)
  })

  it('undo pressed inside the fade window keeps the task visible after the fade refresh', async () => {
    b.t.repo.create({ title: '빨리 되돌릴 일', date: TODAY })
    render(createElement(App))
    const c = await card()
    await user.click(await box(c, '빨리 되돌릴 일'))
    await user.click(within(notice(c)!).getByRole('button', { name: ko.tasks.undo.button }))
    await act(async () => vi.advanceTimersByTime(2000))
    expect(within(c).getByText('빨리 되돌릴 일')).toBeTruthy()
    expect(((await box(c, '빨리 되돌릴 일')) as HTMLInputElement).checked).toBe(false)
  })

  it('undo of a task removed elsewhere meanwhile shows an error and does not crash', async () => {
    const t = b.t.repo.create({ title: '사라질 일', date: TODAY })
    render(createElement(App))
    const c = await card()
    await user.click(await box(c, '사라질 일'))
    await within(c).findByRole('status')
    b.t.repo.remove(t.id)
    await user.click(within(notice(c)!).getByRole('button', { name: ko.tasks.undo.button }))
    expect(await within(c).findByRole('alert')).toBeTruthy()
    expect(notice(c)).toBeNull()
  })

  it('leaving home while the notice is up and coming back shows no stale notice and no errors', async () => {
    b.t.repo.create({ title: '두고 갈 일', date: TODAY })
    render(createElement(App))
    const c = await card()
    await user.click(await box(c, '두고 갈 일'))
    await within(c).findByRole('status')
    const nav = screen.getByRole('navigation', { name: ko.nav.label })
    await user.click(within(nav).getByRole('button', { name: ko.nav.memos }))
    await act(async () => vi.advanceTimersByTime(7000))
    await user.click(within(nav).getByRole('button', { name: ko.nav.home }))
    const again = await card()
    expect(notice(again)).toBeNull()
    expect(within(again).queryByRole('alert')).toBeNull()
  })
})

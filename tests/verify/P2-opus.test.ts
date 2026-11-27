// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// P2 독립 검증(Opus): '안 하기로 함' 되찾기.
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

const t = ko.tasks
const TODAY = '2026-03-10'
let b: Backend
let user: ReturnType<typeof userEvent.setup>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  b = installBackend()
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

const views = (): HTMLElement => screen.getByRole('navigation', { name: t.viewsNavLabel })
const viewButton = (v: keyof typeof t.views): HTMLElement => within(views()).getByRole('button', { name: new RegExp(`^${t.views[v]}`) })
async function openTasks() {
  render(createElement(App))
  await user.click(await screen.findByRole('button', { name: ko.nav.tasks }))
  await screen.findByRole('navigation', { name: t.viewsNavLabel })
}
async function cancelViaPanel(title: string) {
  await user.click(await screen.findByText(title))
  await screen.findByRole('complementary', { name: t.detail.title })
  await user.click(screen.getByRole('button', { name: t.detail.cancelTask }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull())
}
async function showCanceled() {
  await user.click(viewButton('done'))
  await user.click(await screen.findByRole('button', { name: t.doneFilter.canceled }))
}

describe('P2 (Opus)', () => {
  it('wording: the panel button is 안 하기 and the undo notice says 안 하기로 했어요', async () => {
    b.t.repo.create({ title: '문구 확인', date: TODAY })
    await openTasks()
    await cancelViaPanel('문구 확인')
    expect((await screen.findByRole('status')).textContent).toContain(t.undo.canceled('문구 확인'))
    expect(screen.queryByText('취소')).toBeNull()
  })

  it.each([
    ['upcoming', { date: '2026-03-20' }],
    ['inbox', {}],
    ['someday', { bucket: 'someday' as const }]
  ] as const)('a task canceled from %s comes back to the same view after 다시 열기', async (view, fields) => {
    b.t.repo.create({ title: '돌아갈 일', ...fields })
    await openTasks()
    await user.click(viewButton(view))
    await cancelViaPanel('돌아갈 일')
    await act(async () => vi.advanceTimersByTime(6500))
    await showCanceled()
    await user.click(await screen.findByRole('button', { name: t.reopenLabel('돌아갈 일') }))
    await waitFor(() => expect(b.t.repo.listCanceled()).toEqual([]))
    await user.click(viewButton(view))
    expect(await screen.findByText('돌아갈 일')).toBeTruthy()
  })

  it('the 완료 filter shows only done tasks and the done count ignores canceled ones', async () => {
    const d = b.t.repo.create({ title: '끝낸 일', date: TODAY })
    const c = b.t.repo.create({ title: '안 한 일', date: TODAY })
    b.t.repo.setStatus(d.id, 'done')
    b.t.repo.setStatus(c.id, 'canceled')
    await openTasks()
    await user.click(viewButton('done'))
    expect(await screen.findByText('끝낸 일')).toBeTruthy()
    expect(screen.queryByText('안 한 일')).toBeNull()
    expect(viewButton('done').textContent).toMatch(/1/)
    expect(viewButton('done').textContent).not.toMatch(/2/)
    await user.click(screen.getByRole('button', { name: t.doneFilter.canceled }))
    expect(await screen.findByText('안 한 일')).toBeTruthy()
    expect(screen.queryByText('끝낸 일')).toBeNull()
  })

  it('calendar month done count and day marks ignore canceled tasks', async () => {
    const d = b.t.repo.create({ title: '끝', date: TODAY })
    const c = b.t.repo.create({ title: '안 함', date: TODAY })
    b.t.repo.setStatus(d.id, 'done')
    b.t.repo.setStatus(c.id, 'canceled')
    render(createElement(App))
    await user.click(await screen.findByRole('button', { name: ko.nav.calendar }))
    expect(await screen.findByText(ko.calendarScreen.monthDone(1, 1))).toBeTruthy()
  })

  it('canceled tasks are grouped by the day they were set aside, newest first', async () => {
    const old = b.t.repo.create({ title: '그제 안 함', date: TODAY })
    b.t.setNow(new Date(2026, 2, 8, 9, 0, 0).toISOString())
    b.t.repo.setStatus(old.id, 'canceled')
    b.t.setNow(new Date(2026, 2, 10, 12, 0, 0).toISOString())
    const fresh = b.t.repo.create({ title: '오늘 안 함', date: TODAY })
    b.t.repo.setStatus(fresh.id, 'canceled')
    await openTasks()
    await showCanceled()
    await screen.findByText('오늘 안 함')
    const buttons = screen.getAllByRole('button', { name: /^다시 열기/ })
    expect(buttons.map((x) => x.getAttribute('aria-label'))).toEqual([t.reopenLabel('오늘 안 함'), t.reopenLabel('그제 안 함')])
    expect(buttons[0].closest('section')).not.toBe(buttons[1].closest('section'))
  })

  it('reopen failure (rejected IPC) shows an error and keeps the row', async () => {
    const c = b.t.repo.create({ title: '안 열릴 일', date: TODAY })
    b.t.repo.setStatus(c.id, 'canceled')
    await openTasks()
    await showCanceled()
    b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    await user.click(await screen.findByRole('button', { name: t.reopenLabel('안 열릴 일') }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: t.reopenLabel('안 열릴 일') })).toBeTruthy()
    expect(b.t.repo.get(c.id)?.status).toBe('canceled')
  })

  it('a canceled task never appears in today/upcoming/inbox lists', async () => {
    for (const fields of [{ date: TODAY }, { date: '2026-03-20' }, {}]) {
      const x = b.t.repo.create({ title: '숨은 일', ...fields })
      b.t.repo.setStatus(x.id, 'canceled')
    }
    await openTasks()
    for (const v of ['today', 'upcoming', 'inbox'] as const) {
      await user.click(viewButton(v))
      await screen.findByRole('heading', { level: 1, name: t.views[v] })
      expect(screen.queryByText('숨은 일')).toBeNull()
    }
  })
})

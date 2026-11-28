// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// N6 독립 검증(Opus): 행마다 늘 보이는 ⋯ 메뉴. 키보드로 다루고, 삭제는 확인 후, 항목 구성은 상세 패널 규칙과 같다.
import { createElement, type ComponentType } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

const TODAY = '2026-11-26'

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

const more = (title: string): HTMLElement => screen.getByRole('button', { name: ko.rowMenu.more(title) })
const menuOf = (title: string): HTMLElement => screen.getByRole('menu', { name: ko.rowMenu.menu(title) })
const itemNames = (title: string): string[] => within(menuOf(title)).getAllByRole('menuitem').map((el) => el.textContent ?? '')

async function openTasks(): Promise<void> {
  render(createElement(App))
  await screen.findByRole('region', { name: ko.home.cards.todo })
  await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.tasks }))
}

describe('N6 (Opus)', () => {
  it('every row has its own named ⋯; aria-expanded follows the menu; Esc closes and returns focus', async () => {
    b.t.repo.create({ title: '첫 일', date: TODAY })
    b.t.repo.create({ title: '둘째 일', date: TODAY })
    await openTasks()
    await screen.findByText('첫 일')
    expect(more('첫 일')).not.toBe(more('둘째 일'))
    more('첫 일').focus()
    await user.keyboard('{Enter}')
    expect(more('첫 일').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more('첫 일'))
    expect(more('첫 일').getAttribute('aria-expanded')).toBe('false')
  })

  it('Tab moves away and closes the menu', async () => {
    b.t.repo.create({ title: '탭 일', date: TODAY })
    await openTasks()
    await screen.findByText('탭 일')
    more('탭 일').focus()
    await user.keyboard('{Enter}')
    await user.tab()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('delete from the menu asks first: 취소 keeps the task, 삭제 removes it', async () => {
    const task = b.t.repo.create({ title: '지울지 말지', date: TODAY })
    await openTasks()
    await screen.findByText('지울지 말지')
    await user.click(more('지울지 말지'))
    await user.click(within(menuOf('지울지 말지')).getByRole('menuitem', { name: ko.tasks.detail.remove }))
    expect(b.t.repo.get(task.id)).toBeTruthy()
    const cancel = await screen.findByRole('button', { name: ko.tasks.detail.cancel })
    await user.click(cancel)
    expect(b.t.repo.get(task.id)).toBeTruthy()

    await user.click(more('지울지 말지'))
    await user.click(within(menuOf('지울지 말지')).getByRole('menuitem', { name: ko.tasks.detail.remove }))
    const confirmYes = screen.getAllByRole('button', { name: ko.tasks.detail.confirmRemoveYes }).find((el) => el.getAttribute('role') !== 'menuitem')!
    await user.click(confirmYes)
    await waitFor(() => expect(b.t.repo.get(task.id)).toBeUndefined())
  })

  it('menu items follow the detail-panel rules: repeating has no 나중에로, checklist items only 편집', async () => {
    b.t.repo.create({ title: '매일 일', date: TODAY, repeat: { freq: 'daily', interval: 1 } })
    b.routineRepo.create({ title: '체크 항목', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
    await openTasks()
    await screen.findByText('매일 일')
    await user.click(more('매일 일'))
    expect(itemNames('매일 일')).not.toContain(ko.tasks.detail.moveToSomeday)
    expect(itemNames('매일 일')).toContain(ko.tasks.detail.cancelTask)
    await user.keyboard('{Escape}')
    await user.click(more('체크 항목'))
    expect(itemNames('체크 항목')).toEqual([ko.tasks.rowMenu.edit])
  })

  it('overdue rows have the menu too: 나중에로 moves the task to 나중에', async () => {
    const task = b.t.repo.create({ title: '밀린 일', date: '2026-11-20' })
    await openTasks()
    await screen.findByText('밀린 일')
    more('밀린 일').focus()
    await user.keyboard('{Enter}')
    const target = within(menuOf('밀린 일')).getByRole('menuitem', { name: ko.tasks.detail.moveToSomeday })
    while (document.activeElement !== target) await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(b.t.repo.get(task.id)?.bucket).toBe('someday'))
  })
})

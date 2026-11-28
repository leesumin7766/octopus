// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// P6b 독립 검증(Opus): 업데이트 설치 전, 어느 화면에든 쓰던 내용이 있으면 먼저 묻는다. 계속 쓰기면 설치하지 않고 내용이 그대로 남는다.
import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

const n = ko.notices
const m = ko.home.localCalendar

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

let b: Backend
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  b = installBackend('home')
  Object.assign(b.updateState, { status: 'ready', version: '0.2.0' })
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

const nav = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name }))

async function installFromBell(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: n.buttonLabel(1) }))
  const panel = screen.getByRole('dialog', { name: n.panel })
  await user.click(within(panel).getByRole('button', { name: n.update.install }))
  return panel
}

describe('P6b (Opus)', () => {
  it('a new-memo draft on the memo screen: asks; 계속 쓰기 keeps the draft and does not install', async () => {
    const user = userEvent.setup()
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await nav(user, ko.nav.memos)
    const draft = (await screen.findByLabelText(ko.memos.newLabel)) as HTMLTextAreaElement
    await user.type(draft, '설치 전에 쓰던 메모')
    const panel = await installFromBell(user)
    expect(within(panel).getByText(m.discardTitle)).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: m.discardNo }))
    expect(b.update.install).not.toHaveBeenCalled()
    expect((screen.getByLabelText(ko.memos.newLabel) as HTMLTextAreaElement).value).toBe('설치 전에 쓰던 메모')
  })

  it('an unsaved task-detail edit counts too; 버리기 installs exactly once', async () => {
    const user = userEvent.setup()
    b.t.repo.create({ title: '고치던 일', date: '2026-11-26' })
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await nav(user, ko.nav.tasks)
    await user.click(await screen.findByText('고치던 일'))
    const detail = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
    fireEvent.change(within(detail).getByLabelText(ko.tasks.detail.titleField), { target: { value: '고치던 일!' } })
    const panel = await installFromBell(user)
    await user.click(within(panel).getByRole('button', { name: m.discardYes }))
    await waitFor(() => expect(b.update.install).toHaveBeenCalledTimes(1))
  })

  it('after the draft is saved there is nothing to ask', async () => {
    const user = userEvent.setup()
    render(createElement(App))
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.type(within(card).getByLabelText(ko.tasks.quickInputLabel), '오늘 보고서{Enter}')
    await within(card).findByText('보고서')
    const panel = await installFromBell(user)
    expect(within(panel).queryByText(m.discardTitle)).toBeNull()
    expect(b.update.install).toHaveBeenCalledTimes(1)
  })
})

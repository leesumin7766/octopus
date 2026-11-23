// @vitest-environment jsdom
import { rmSync } from 'node:fs'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { safeInvoke } from '../../src/renderer/safeInvoke'
import { installBackend, type Backend } from './backend'

// main 이 그 채널을 모르는 오래된 실행처럼 invoke 가 예외로 거부되어도, 화면은 오류 상태로 보여 주고
// 처리되지 않은 Promise 거부가 남지 않아야 한다(주기적으로 다시 읽는 곳이 특히 그렇다).

describe('safeInvoke', () => {
  it('passes results through and turns a rejected call into an error result', async () => {
    expect(await safeInvoke(async () => ({ ok: true as const, data: 5 }))).toEqual({ ok: true, data: 5 })
    expect(await safeInvoke(async () => ({ ok: false as const, error: { code: 'not_found' as const } }))).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await safeInvoke(async () => Promise.reject(new Error("No handler registered for 'calendar:today'")))).toEqual({ ok: false, error: { code: 'internal' } })
    expect(await safeInvoke((() => {
      throw new TypeError('window.octopus.calendar is undefined')
    }) as never)).toEqual({ ok: false, error: { code: 'internal' } })
  })
})

describe('calls that reject', () => {
  let b: Backend
  const unhandled = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    window.addEventListener('unhandledrejection', unhandled)
  })
  afterEach(() => {
    window.removeEventListener('unhandledrejection', unhandled)
    unhandled.mockClear()
    cleanup()
    b?.armManager.dispose()
    b?.t.db.close()
    if (b) rmSync(b.vault, { recursive: true, force: true })
    vi.useRealTimers()
  })

  const reject = (): Promise<never> => Promise.reject(new Error("No handler registered for 'x'"))

  it('the home schedule card shows an error (not a blank or a crash) when calendar:today rejects, and the rest of home works', async () => {
    b = installBackend('home')
    b.calendar.today.mockImplementation(reject as never)
    render(<App />)

    const card = await screen.findByRole('region', { name: ko.home.cards.calendar })
    expect((await within(card).findByRole('alert')).textContent).toBe(ko.home.calendar.loadFailed)
    expect(await screen.findByRole('region', { name: ko.home.cards.todo })).toBeTruthy()
    await new Promise((r) => setTimeout(r, 30))
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('home also survives arms:list rejecting (the pie menu simply has no Obsidian)', async () => {
    b = installBackend('home')
    b.arms.list.mockImplementation(reject as never)
    render(<App />)
    expect(await screen.findByRole('region', { name: ko.home.cards.todo })).toBeTruthy()
    await new Promise((r) => setTimeout(r, 30))
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('the Arms screen, MCP section and Obsidian screen show an error banner instead of leaking a rejection', async () => {
    const user = userEvent.setup()
    b = installBackend('arms')
    b.arms.list.mockImplementation(reject as never)
    b.mcp.list.mockImplementation(reject as never)
    render(<App />)

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('region', { name: ko.arms.mcp.title })).toBeTruthy()

    b.obsidian.state.mockImplementation(reject as never)
    cleanup()
    b.armManager.register(b.obsidianArm)
    render(<App />)
    await user.click(within(await screen.findByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.arms }))
    await new Promise((r) => setTimeout(r, 30))
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('the inbox, the command window and settings tolerate rejecting calls too', async () => {
    b = installBackend('inbox')
    b.candidates.list.mockImplementation(reject as never)
    b.command.models.mockImplementation(reject as never)
    b.update.state.mockImplementation(reject as never)
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: ko.tasks.views.inbox })).toBeTruthy()

    const user = userEvent.setup()
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.settings }))
    expect(await screen.findByRole('heading', { level: 1, name: ko.settings.title })).toBeTruthy()
    await waitFor(() => expect(b.update.state).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    expect(unhandled).not.toHaveBeenCalled()
  })
})

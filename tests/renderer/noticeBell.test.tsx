// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// ATDT 와 같은 제목 줄 알림 표시. 알림이 있을 때만 보이고, 누르면 그 안에서 업데이트를 받고 설치한다.
const n = ko.notices

describe('notice bell in the title bar', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const bell = (): HTMLElement | null => screen.queryByRole('button', { name: n.buttonLabel(1) })
  const start = async (): Promise<HTMLElement> => {
    const { container } = render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })
    return container.querySelector('header.app-drag') as HTMLElement
  }

  it('is not there while there is nothing to tell', async () => {
    b = installBackend('home')
    await start()
    expect(bell()).toBeNull()
    expect(screen.queryByText(n.update.install)).toBeNull()
  })

  it('a new version shows only a small "알림 1" in the title bar; the actions are inside the panel', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0', notes: '바뀐 점' })
    const bar = await start()
    const button = await within(bar).findByRole('button', { name: n.buttonLabel(1) })
    expect(button.textContent).toBe(n.button(1))
    expect(button.closest('.app-no-drag')).not.toBeNull()
    expect(screen.queryByRole('button', { name: n.update.download })).toBeNull() // 닫혀 있으면 버튼이 보이지 않는다

    await user.click(button)
    const panel = screen.getByRole('dialog', { name: n.panel })
    expect(within(panel).getByText(n.update.available('0.2.0'))).toBeTruthy()
    expect(within(panel).getByText('바뀐 점')).toBeTruthy()
    expect(b.update.download).not.toHaveBeenCalled()
    await user.click(within(panel).getByRole('button', { name: n.update.download }))
    expect(b.update.download).toHaveBeenCalledTimes(1)
  })

  it('shows progress, then [다시 시작해서 설치] inside the panel; installing only happens on click', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0' })
    await start()
    await user.click(await screen.findByRole('button', { name: n.buttonLabel(1) }))

    act(() => b.emitUpdate({ status: 'downloading', current: '0.1.0', version: '0.2.0', percent: 30 }))
    const panel = screen.getByRole('dialog', { name: n.panel })
    expect(within(panel).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30')

    act(() => b.emitUpdate({ status: 'ready', current: '0.1.0', version: '0.2.0' }))
    expect(b.update.install).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog', { name: n.panel })).getByRole('button', { name: n.update.install }))
    expect(b.update.install).toHaveBeenCalledTimes(1)
  })

  it('[나중에] clears the notice until the next step; Esc and an outside click close the panel', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0' })
    await start()

    await user.click(await screen.findByRole('button', { name: n.buttonLabel(1) }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: n.panel })).toBeNull()

    await user.click(bell() as HTMLElement)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: n.panel })).toBeNull()

    await user.click(bell() as HTMLElement)
    await user.click(within(screen.getByRole('dialog', { name: n.panel })).getByRole('button', { name: n.later }))
    expect(bell()).toBeNull()

    act(() => b.emitUpdate({ status: 'available', current: '0.1.0', version: '0.2.0' }))
    expect(bell()).toBeNull()
    act(() => b.emitUpdate({ status: 'ready', current: '0.1.0', version: '0.2.0' }))
    expect(bell()).not.toBeNull()
  })

  it('checking and failures do not ring the bell (they are only in settings)', async () => {
    b = installBackend('home')
    await start()
    act(() => b.emitUpdate({ status: 'checking', current: '0.1.0' }))
    expect(bell()).toBeNull()
    act(() => b.emitUpdate({ status: 'error', current: '0.1.0', error: 'offline' }))
    expect(bell()).toBeNull()
  })
})

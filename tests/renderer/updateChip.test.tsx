// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// 업데이트 알림은 ATDT 의 팝업 대신 제목 줄 안의 한 줄 알림이다. 화면 자리를 차지하지 않는다.
const u = ko.settings.update
const c = u.chip

describe('update notice in the title bar', () => {
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

  const chip = (): HTMLElement | null => screen.queryByRole('group', { name: c.label })
  const ready = async (): Promise<HTMLElement> => {
    const { container } = render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })
    return container.querySelector('header.app-drag') as HTMLElement
  }

  it('shows nothing while the app is up to date', async () => {
    b = installBackend('home')
    await ready()
    expect(chip()).toBeNull()
  })

  it('a new version: one line inside the title bar, no-drag, and only [받기] downloads', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0', auto: true })
    const bar = await ready()
    const group = await within(bar).findByRole('group', { name: c.label })
    expect(group.className).toContain('app-no-drag')
    expect(group.textContent).toContain(c.available('0.2.0'))
    expect(b.update.download).not.toHaveBeenCalled()
    await user.click(within(group).getByRole('button', { name: c.download }))
    expect(b.update.download).toHaveBeenCalledTimes(1)
  })

  it('follows the download and then offers install; installing only happens on click', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0' })
    await ready()
    await screen.findByRole('group', { name: c.label })

    act(() => b.emitUpdate({ status: 'downloading', current: '0.1.0', version: '0.2.0', percent: 30 }))
    expect(within(chip() as HTMLElement).getByText(c.downloading(30))).toBeTruthy()
    expect(within(chip() as HTMLElement).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30')

    act(() => b.emitUpdate({ status: 'ready', current: '0.1.0', version: '0.2.0' }))
    const install = within(chip() as HTMLElement).getByRole('button', { name: c.install })
    expect(b.update.install).not.toHaveBeenCalled()
    await user.click(install)
    expect(b.update.install).toHaveBeenCalledTimes(1)
  })

  it('× hides it until the next step (downloaded), so it never nags about the same thing', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0' })
    await ready()
    await user.click(within(await screen.findByRole('group', { name: c.label })).getByRole('button', { name: c.dismiss }))
    expect(chip()).toBeNull()

    act(() => b.emitUpdate({ status: 'available', current: '0.1.0', version: '0.2.0' }))
    expect(chip()).toBeNull()
    act(() => b.emitUpdate({ status: 'ready', current: '0.1.0', version: '0.2.0' }))
    expect(chip()).not.toBeNull()
  })

  it('failures and "checking" stay out of the title bar (they are only in settings)', async () => {
    b = installBackend('home')
    await ready()
    act(() => b.emitUpdate({ status: 'checking', current: '0.1.0' }))
    expect(chip()).toBeNull()
    act(() => b.emitUpdate({ status: 'error', current: '0.1.0', error: 'offline' }))
    expect(chip()).toBeNull()
  })
})

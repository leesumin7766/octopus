// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { createLeaveGuardStore, LeaveGuardProvider } from '../../src/renderer/leaveGuard'
import { UpdateSection } from '../../src/renderer/settings/UpdateSection'
import { installBackend, type Backend } from './backend'

// P6b: [다시 시작해서 설치] 전에 쓰던 내용이 있으면 먼저 묻는다. 계속 쓰기면 설치하지 않고, 버리기면 설치한다.
const n = ko.notices
const u = ko.settings.update
const m = ko.home.localCalendar

describe('install asks first when something is unsaved', () => {
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

  describe('notice bell', () => {
    async function openPanel(user: ReturnType<typeof userEvent.setup>, draft: string | null): Promise<HTMLElement> {
      b = installBackend('home')
      Object.assign(b.updateState, { status: 'ready', version: '0.2.0' })
      render(<App />)
      const card = await screen.findByRole('region', { name: ko.home.cards.todo })
      if (draft !== null) await user.type(within(card).getByLabelText(ko.tasks.quickInputLabel), draft)
      await user.click(await screen.findByRole('button', { name: n.buttonLabel(1) }))
      return screen.getByRole('dialog', { name: n.panel })
    }

    it('with a draft: asks, 계속 쓰기 does not install, 버리기 installs', async () => {
      const user = userEvent.setup()
      const panel = await openPanel(user, '쓰던 글')
      await user.click(within(panel).getByRole('button', { name: n.update.install }))

      expect(within(panel).getByText(m.discardTitle)).toBeTruthy()
      expect(b.update.install).not.toHaveBeenCalled()
      await user.click(within(panel).getByRole('button', { name: m.discardNo }))
      expect(b.update.install).not.toHaveBeenCalled()
      expect(within(panel).queryByText(m.discardTitle)).toBeNull()

      await user.click(within(panel).getByRole('button', { name: n.update.install }))
      await user.click(within(panel).getByRole('button', { name: m.discardYes }))
      expect(b.update.install).toHaveBeenCalledTimes(1)
    })

    it('without a draft: installs at once', async () => {
      const user = userEvent.setup()
      const panel = await openPanel(user, null)
      await user.click(within(panel).getByRole('button', { name: n.update.install }))
      expect(b.update.install).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(m.discardTitle)).toBeNull()
    })
  })

  describe('settings', () => {
    function renderSection(dirty: boolean): void {
      b = installBackend('settings')
      Object.assign(b.updateState, { status: 'ready', version: '0.2.0' })
      const guard = createLeaveGuardStore()
      if (dirty) guard.set('draft', true)
      render(
        <LeaveGuardProvider value={guard}>
          <UpdateSection />
        </LeaveGuardProvider>
      )
    }
    const section = (): HTMLElement => screen.getByRole('region', { name: u.title })

    it('with unsaved content: asks, 계속 쓰기 does not install, 버리기 installs', async () => {
      const user = userEvent.setup()
      renderSection(true)
      await user.click(await within(section()).findByRole('button', { name: u.install }))

      expect(within(section()).getByText(m.discardTitle)).toBeTruthy()
      expect(b.update.install).not.toHaveBeenCalled()
      await user.click(within(section()).getByRole('button', { name: m.discardNo }))
      expect(b.update.install).not.toHaveBeenCalled()

      await user.click(within(section()).getByRole('button', { name: u.install }))
      await user.click(within(section()).getByRole('button', { name: m.discardYes }))
      expect(b.update.install).toHaveBeenCalledTimes(1)
    })

    it('without unsaved content: installs at once', async () => {
      const user = userEvent.setup()
      renderSection(false)
      await user.click(await within(section()).findByRole('button', { name: u.install }))
      expect(b.update.install).toHaveBeenCalledTimes(1)
    })
  })
})

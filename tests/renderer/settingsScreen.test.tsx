// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { DEFAULT_PIE_SLOTS, shortcutAction, type ActionId } from '../../src/shared/pie/actions'
import type { IpcResult } from '../../src/shared/ipc'
import type { UpdateState } from '../../src/shared/update/types'
import { installBackend, type Backend } from './backend'

const t = ko.settings

describe('settings screen', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const prepare = (initial: 'settings' | 'home' = 'settings'): Backend => (b = installBackend(initial))
  const show = (): void => void render(<App />)
  const pieRegion = (): HTMLElement => screen.getByRole('region', { name: t.pieTitle })
  const slotSelect = (n: number): HTMLSelectElement =>
    screen.getByLabelText(t.slotLabel(n, t.positions[n - 1])) as HTMLSelectElement
  const menu = (): HTMLElement => screen.getByRole('navigation', { name: ko.nav.label })

  it('is reached from the left menu, above the "화면 배치" button', async () => {
    const user = userEvent.setup()
    prepare('home')
    show()
    await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })

    await user.click(within(menu()).getByRole('button', { name: ko.nav.settings }))

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeTruthy()
    expect(within(menu()).getByRole('button', { name: ko.nav.settings }).getAttribute('aria-current')).toBe('page')
    expect(within(menu()).queryByRole('button', { name: ko.nav.arrange })).toBeNull() // 홈이 아니라서 보이지 않는다(ATDT 와 같게)
    await user.click(within(menu()).getByRole('button', { name: ko.nav.home }))
    const labels = within(menu()).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(labels.indexOf(ko.nav.settings)).toBe(labels.indexOf(ko.nav.arrange) - 1)
  })

  it('shows the model connection section, the pie menu section, then updates', async () => {
    prepare()
    show()

    await screen.findByRole('heading', { level: 1, name: t.title })

    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([t.model.title, t.pieTitle, t.update.title])
  })

  it('lists the eight slots in order from 12 o\'clock, each set to the saved action', async () => {
    prepare()
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })
    await waitFor(() => expect(slotSelect(1).value).toBe('command'))

    expect(within(pieRegion()).getAllByRole('combobox')).toHaveLength(8)
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => slotSelect(n).value)).toEqual([...DEFAULT_PIE_SLOTS])
    expect(slotSelect(1).getAttribute('aria-label')).toContain('위')
    expect(slotSelect(3).getAttribute('aria-label')).toContain('오른쪽')
    expect(slotSelect(5).getAttribute('aria-label')).toContain('아래')
    expect(slotSelect(7).getAttribute('aria-label')).toContain('왼쪽')
  })

  it('each list offers every action', async () => {
    prepare()
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })
    await waitFor(() => expect(slotSelect(1).value).toBe('command'))

    const labels = within(slotSelect(1)).getAllByRole('option').map((option) => option.textContent)

    for (const label of ['홈 화면', '할 일 화면', '체크리스트 화면', '메모 화면', '설정 화면', '할 일 바로 추가', '메모 바로 추가', '지시하기', 'Arms 관리']) {
      expect(labels).toContain(label)
    }
    expect(labels).not.toContain('메일 (Arm 연결 필요)')
    expect(labels.some((label) => label?.includes('달력'))).toBe(true)
  })

  it('changing a slot saves right away (all eight stay, only that one changes)', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })
    await waitFor(() => expect(slotSelect(2).value).toBe('task:quickAdd'))

    await user.selectOptions(slotSelect(2), 'nav:routines')

    const expected: ActionId[] = [...DEFAULT_PIE_SLOTS]
    expected[1] = 'nav:routines'
    await waitFor(() => expect(backend.settings.set).toHaveBeenCalledWith('pie.slots', expected))
    expect(backend.settingsRepo.get('pie.slots')).toEqual(expected)
    expect(slotSelect(2).value).toBe('nav:routines')
  })

  it('the change shows up in the pie menu on the home screen', async () => {
    const user = userEvent.setup()
    prepare()
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })
    await waitFor(() => expect(slotSelect(8).value).toBe('arms'))

    await user.selectOptions(slotSelect(8), 'nav:memos')
    await waitFor(() => expect(b.settingsRepo.get('pie.slots')[7]).toBe('nav:memos'))
    await user.click(within(menu()).getByRole('button', { name: ko.nav.home }))
    await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))

    const wedges = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(wedges[7].getAttribute('aria-label')).toBe('메모 보기')
    expect(wedges[7].getAttribute('aria-disabled')).toBeNull()
  })

  it('"기본값으로" puts the eight defaults back and saves them', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.settingsRepo.set('pie.slots', ['nav:home', 'nav:home', 'nav:home', 'nav:home', 'nav:home', 'nav:home', 'nav:home', 'nav:home'])
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })
    await waitFor(() => expect(slotSelect(1).value).toBe('nav:home'))

    await user.click(screen.getByRole('button', { name: t.reset }))

    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => slotSelect(n).value)).toEqual([...DEFAULT_PIE_SLOTS])
    await waitFor(() => expect(backend.settings.set).toHaveBeenLastCalledWith('pie.slots', [...DEFAULT_PIE_SLOTS]))
    expect(backend.settingsRepo.get('pie.slots')).toEqual([...DEFAULT_PIE_SLOTS])
  })

  describe('update section', () => {
    const u = t.update
    const section = (): HTMLElement => screen.getByRole('region', { name: u.title })

    it('always shows the installed version, and [업데이트 확인] asks main to check now', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      expect(await screen.findByText(u.status.latest)).toBeTruthy()
      expect(within(section()).getByText('0.1.0')).toBeTruthy()
      expect(within(section()).queryByRole('button', { name: u.install })).toBeNull()

      backend.updateState.status = 'available'
      backend.updateState.version = '0.2.0'
      await user.click(within(section()).getByRole('button', { name: u.check }))
      expect(backend.update.check).toHaveBeenCalledTimes(1)
      expect(await within(section()).findByText(u.status.available('0.2.0'))).toBeTruthy()
    })

    it('a new version is only fetched when [업데이트 받기] is clicked; its notes can be opened', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      Object.assign(backend.updateState, { status: 'available', version: '0.2.0', notes: '바뀐 점 한 줄' })
      show()
      const button = await screen.findByRole('button', { name: u.download })
      expect(backend.update.download).not.toHaveBeenCalled()
      expect(within(section()).getByText('바뀐 점 한 줄')).toBeTruthy()
      await user.click(button)
      expect(backend.update.download).toHaveBeenCalledTimes(1)
    })

    it('while downloading it shows progress, cannot check again, and offers no install', async () => {
      const backend = prepare()
      Object.assign(backend.updateState, { status: 'downloading', version: '0.2.0', percent: 40 })
      show()
      expect(await screen.findByText(u.status.downloading('0.2.0'))).toBeTruthy()
      expect(within(section()).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
      expect((within(section()).getByRole('button', { name: u.check }) as HTMLButtonElement).disabled).toBe(true)
      expect(within(section()).queryByRole('button', { name: u.install })).toBeNull()
    })

    it('a downloaded version offers [다시 시작해서 설치], and only clicking it installs', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      Object.assign(backend.updateState, { status: 'ready', version: '0.2.0' })
      show()
      const button = await within(await screen.findByRole('region', { name: u.title })).findByRole('button', { name: u.install })
      expect(screen.getByText(u.status.ready('0.2.0'))).toBeTruthy()
      expect(backend.update.install).not.toHaveBeenCalled() // 알림만으로는 설치하지 않는다
      await user.click(button)
      expect(backend.update.install).toHaveBeenCalledTimes(1)
    })

    it('a failed check says what to do next', async () => {
      const backend = prepare()
      Object.assign(backend.updateState, { status: 'error', error: 'offline' })
      show()
      const alert = await within(await screen.findByRole('region', { name: u.title })).findByRole('alert')
      expect(alert.textContent).toContain(u.errors.offline)
    })

    it('a failed check says so, [다시 시도] checks again, and success clears the message', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await screen.findByText(u.status.latest)
      backend.update.check.mockResolvedValueOnce({ ok: false as const, error: { code: 'internal' } })

      await user.click(within(section()).getByRole('button', { name: u.check }))
      const alert = await within(section()).findByRole('alert')
      expect(alert.textContent).toContain(u.failed.check)

      await user.click(within(alert).getByRole('button', { name: u.retry }))
      expect(backend.update.check).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(within(section()).queryByRole('alert')).toBeNull())
    })

    it('a rejected check is reported the same way', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await screen.findByText(u.status.latest)
      backend.update.check.mockRejectedValueOnce(new Error('boom'))

      await user.click(within(section()).getByRole('button', { name: u.check }))
      expect(await within(section()).findByText(u.failed.check)).toBeTruthy()
    })

    it('a failed download shows in settings too, and [다시 시도] downloads again', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      Object.assign(backend.updateState, { status: 'available', version: '0.2.0' })
      show()
      backend.update.download.mockRejectedValueOnce(new Error('boom'))
      await user.click(await screen.findByRole('button', { name: u.download }))

      const alert = await within(section()).findByRole('alert')
      expect(alert.textContent).toContain(u.failed.download)
      await user.click(within(alert).getByRole('button', { name: u.retry }))
      expect(backend.update.download).toHaveBeenCalledTimes(2)
    })

    it('a second check while one is running sends nothing new', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await screen.findByText(u.status.latest)
      let finish: () => void = () => undefined
      backend.update.check.mockImplementationOnce(
        () =>
          new Promise<IpcResult<UpdateState>>((resolve) => {
            finish = () => resolve({ ok: true, data: { ...backend.updateState } })
          })
      )
      const button = within(section()).getByRole('button', { name: u.check }) as HTMLButtonElement

      await user.click(button)
      await user.click(button)
      expect(backend.update.check).toHaveBeenCalledTimes(1)
      expect(button.disabled).toBe(true)

      act(() => finish())
      await waitFor(() => expect(button.disabled).toBe(false))
    })

    it('in development it explains that nothing is checked, and has no check button', async () => {
      const backend = prepare()
      backend.updateState.status = 'disabled'
      show()
      expect(await screen.findByText(u.status.disabled)).toBeTruthy()
      expect(within(section()).queryByRole('button', { name: u.check })).toBeNull()
    })

    it('follows the state main pushes', async () => {
      const backend = prepare()
      show()
      await screen.findByText(u.status.latest)
      act(() => backend.emitUpdate({ status: 'downloading', current: '0.1.0', version: '0.2.0', percent: 75 }))
      expect(await screen.findByText(u.status.downloading('0.2.0'))).toBeTruthy()
    })
  })

  describe('shortcuts', () => {
    it('can be chosen for a slot, saved as shortcut:<id>', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const link = backend.shortcutRepo.createUrl({ url: 'https://example.com', label: '문서' })
      show()
      await screen.findByRole('heading', { level: 1, name: t.title })
      await waitFor(() => expect(within(slotSelect(1)).queryByText(ko.pie.shortcutLong('문서'))).not.toBeNull())

      await user.selectOptions(slotSelect(1), shortcutAction(link.id))

      await waitFor(() => expect(backend.settingsRepo.get('pie.slots')[0]).toBe(shortcutAction(link.id)))
      expect(slotSelect(1).selectedOptions[0].textContent).toBe(ko.pie.shortcutLong('문서'))
    })

    it('a slot that points at a deleted shortcut still shows that, and can be changed', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const gone = shortcutAction('01ARZ3NDEKTSV4RRFFQ69G5FAV')
      backend.settingsRepo.set('pie.slots', [gone, ...DEFAULT_PIE_SLOTS.slice(1)])
      show()
      await screen.findByRole('heading', { level: 1, name: t.title })
      await waitFor(() => expect(slotSelect(1).value).toBe(gone))

      expect(slotSelect(1).selectedOptions[0].textContent).toBe(ko.pie.deletedShortcut)
      await user.selectOptions(slotSelect(1), 'nav:tasks')

      await waitFor(() => expect(backend.settingsRepo.get('pie.slots')[0]).toBe('nav:tasks'))
    })
  })

  it('starts from the defaults when the saved value cannot be read', async () => {
    const backend = prepare()
    backend.settings.get.mockImplementation(async (key: string) =>
      key === 'pie.slots' ? { ok: false, error: { code: 'db_unavailable' } } : { ok: true, data: key === 'onboarding.done' }
    )
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })

    await waitFor(() => expect(slotSelect(1).value).toBe('command'))
  })

  it('does not change anything but pie.slots', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    show()
    await screen.findByRole('heading', { level: 1, name: t.title })
    await waitFor(() => expect(slotSelect(1).value).toBe('command'))

    await user.selectOptions(slotSelect(3), 'nav:home')
    await user.click(screen.getByRole('button', { name: t.reset }))

    await waitFor(() => expect(backend.settings.set).toHaveBeenCalledTimes(2))
    for (const [key] of backend.settings.set.mock.calls) expect(key).toBe('pie.slots')
  })
})

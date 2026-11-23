// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { DEFAULT_PIE_SLOTS, shortcutAction, type ActionId } from '../../src/shared/pie/actions'
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
    expect((within(menu()).getByRole('button', { name: ko.nav.arrange }) as HTMLButtonElement).disabled).toBe(true) // 홈이 아니라서
    const buttons = within(menu()).getAllByRole('button')
    const labels = buttons.map((button) => button.getAttribute('aria-label'))
    expect(labels.indexOf(ko.nav.settings)).toBe(labels.indexOf(ko.nav.arrange) - 1)
  })

  it('shows the model connection section and then the pie menu section', async () => {
    prepare()
    show()

    await screen.findByRole('heading', { level: 1, name: t.title })

    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([t.model.title, t.pieTitle])
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

    for (const label of ['홈 화면', '할 일 화면', '체크리스트 화면', '메모 화면', '설정 화면', '할 일 바로 추가', '메모 바로 쓰기', '지시하기', '위키', 'Arms 관리']) {
      expect(labels).toContain(label)
    }
    expect(labels.some((label) => label?.includes('캘린더'))).toBe(true)
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

  describe('update notice', () => {
    it('shows nothing when there is no new version', async () => {
      const backend = prepare()
      show()
      await screen.findByRole('heading', { level: 1, name: t.title })
      await waitFor(() => expect(backend.update.state).toHaveBeenCalled())
      expect(screen.queryByRole('button', { name: t.update.install })).toBeNull()
    })

    it('a downloaded version offers [다시 시작해서 설치], and only clicking it installs', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.updateState.status = 'ready'
      backend.updateState.version = '0.2.0'
      show()

      const button = await screen.findByRole('button', { name: t.update.install })
      expect(screen.getByText(t.update.ready('0.2.0'))).toBeTruthy()
      expect(backend.update.install).not.toHaveBeenCalled() // 알림만으로는 설치하지 않는다
      await user.click(button)
      expect(backend.update.install).toHaveBeenCalledTimes(1)
    })

    it('while downloading it only informs (no install button)', async () => {
      const backend = prepare()
      backend.updateState.status = 'downloading'
      backend.updateState.version = '0.2.0'
      show()
      expect(await screen.findByText(t.update.downloading('0.2.0'))).toBeTruthy()
      expect(screen.queryByRole('button', { name: t.update.install })).toBeNull()
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

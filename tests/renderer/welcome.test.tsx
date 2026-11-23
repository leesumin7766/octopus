// @vitest-environment jsdom
import { rmSync } from 'node:fs'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArmError } from '../../src/main/arms/sdk/types'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { fakeArm } from '../arms/helpers'
import { installBackend, type Backend } from './backend'

const t = ko.onboarding

describe('first-run welcome (3 steps)', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(() => {
    cleanup()
    b?.armManager.dispose()
    b?.t.db.close()
    if (b) rmSync(b.vault, { recursive: true, force: true })
    vi.useRealTimers()
  })

  /** 새 사용자(안내를 아직 끝내지 않음)로 시작한다. */
  const prepare = (setup?: (backend: Backend) => void): Backend => {
    b = installBackend('home')
    b.settingsRepo.set('onboarding.done', false)
    setup?.(b)
    return b
  }
  const home = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })
  const step = (n: number): Promise<HTMLElement> => screen.findByRole('heading', { level: 1, name: [t.step1.title, t.step2.title, t.step3.title][n - 1] })
  const bars = (): boolean[] => Array.from(document.querySelectorAll('[data-filled]')).map((e) => e.getAttribute('data-filled') === 'true')

  describe('when it shows', () => {
    it('a new user (no tasks, routines or memos, not done) sees step 1 instead of the app, with no left menu', async () => {
      prepare()
      render(<App />)

      expect(await step(1)).toBeTruthy()
      expect(screen.queryByRole('navigation', { name: ko.nav.label })).toBeNull()
      expect(screen.getByText(t.stepLabel(1))).toBeTruthy()
    })

    it.each([
      ['a task', (backend: Backend) => void backend.t.repo.create({ title: '있던 할 일' })],
      ['a memo', (backend: Backend) => void backend.memoRepo.create('있던 메모')],
      ['a routine', (backend: Backend) => void backend.routineRepo.create({ title: '있던 루틴', days: [0, 1, 2, 3, 4, 5, 6] }, '2026-03-10')]
    ])('an existing user with %s goes straight home and it is recorded as done', async (_name, seed) => {
      const backend = prepare(seed)
      render(<App />)

      expect(await home()).toBeTruthy()
      expect(screen.queryByRole('heading', { name: t.step1.title })).toBeNull()
      await waitFor(() => expect(backend.settingsRepo.get('onboarding.done')).toBe(true))
    })

    it('when it was already finished it never shows again', async () => {
      const backend = prepare()
      backend.settingsRepo.set('onboarding.done', true)
      render(<App />)
      expect(await home()).toBeTruthy()
      expect(backend.tasks.list).not.toHaveBeenCalled() // 끝낸 사용자에게는 확인할 필요도 없다
    })

    it('when the setting cannot be read the app is not blocked: no welcome, straight home', async () => {
      const backend = prepare()
      backend.settings.get.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
      render(<App />)
      expect(await home()).toBeTruthy()
      expect(screen.queryByRole('heading', { name: t.step1.title })).toBeNull()
    })

    it('a user with nothing but a finished task is not treated as new', async () => {
      const backend = prepare((x) => x.t.repo.setStatus(x.t.repo.create({ title: '끝낸 일' }).id, 'done'))
      render(<App />)
      expect(await home()).toBeTruthy()
      await waitFor(() => expect(backend.settingsRepo.get('onboarding.done')).toBe(true))
    })
  })

  describe('the three steps', () => {
    it('step 1 → 2 → 3 with nothing chosen, then the first task: two button clicks and Enter, and the task exists', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      render(<App />)
      await step(1)
      let clicks = 0
      const click = async (el: HTMLElement): Promise<void> => {
        clicks++
        await user.click(el)
      }

      expect(bars()).toEqual([true, false, false])
      expect(screen.getByText(t.privacy)).toBeTruthy()
      await click(screen.getByRole('button', { name: t.next }))
      await step(2)
      expect(screen.getByText(t.stepLabel(2))).toBeTruthy()
      expect(bars()).toEqual([true, true, false])
      expect(screen.getByText(t.step2.none)).toBeTruthy()
      await click(screen.getByRole('button', { name: t.next }))
      await step(3)
      expect(bars()).toEqual([true, true, true])

      const input = screen.getByLabelText(ko.tasks.quickInputLabel)
      expect(document.activeElement).toBe(input)
      await user.type(input, '내일 오후 3시 치과 #건강{Enter}')

      expect(await screen.findByText(t.step3.added('치과'))).toBeTruthy()
      expect(clicks).toBeLessThanOrEqual(2)
      expect(backend.t.repo.listView('upcoming', '2026-03-10').map((x) => x.title)).toEqual(['치과'])
    })

    it('step 3 shows the parsed chips while typing, and [홈으로] is the highlighted button only after the first task is added', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      render(<App />)
      await step(1)
      await user.click(screen.getByRole('button', { name: t.next }))
      await user.click(screen.getByRole('button', { name: t.next }))
      const homeButton = (): HTMLElement => screen.getByRole('button', { name: t.home })
      expect(homeButton().className).not.toContain('bg-accent')

      await user.type(screen.getByLabelText(ko.tasks.quickInputLabel), '매주 월 회의 !높음')
      expect(await screen.findByLabelText(ko.tasks.previewLabel)).toBeTruthy()
      await user.keyboard('{Enter}')

      await waitFor(() => expect(homeButton().className).toContain('bg-accent'))
      expect(backend.t.repo.listView('upcoming', '2026-03-10').length + backend.t.repo.listView('today', '2026-03-10').today.length).toBeGreaterThan(0)
    })

    it('[홈으로] saves "done", shows the home screen with the new task, and does not come back', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      render(<App />)
      await step(1)
      await user.click(screen.getByRole('button', { name: t.next }))
      await user.click(screen.getByRole('button', { name: t.next }))
      await user.type(screen.getByLabelText(ko.tasks.quickInputLabel), '오늘 첫 번째 일{Enter}')
      await screen.findByText(t.step3.added('첫 번째 일'))

      await user.click(screen.getByRole('button', { name: t.home }))

      expect(await home()).toBeTruthy()
      expect(backend.settingsRepo.get('onboarding.done')).toBe(true)
      expect(screen.getByRole('navigation', { name: ko.nav.label })).toBeTruthy()
      expect(await screen.findByText('첫 번째 일')).toBeTruthy()
    })

    it('[이전] goes back a step', async () => {
      const user = userEvent.setup()
      prepare()
      render(<App />)
      await step(1)
      expect(screen.queryByRole('button', { name: t.back })).toBeNull()
      await user.click(screen.getByRole('button', { name: t.next }))
      await user.click(screen.getByRole('button', { name: t.back }))
      expect(await step(1)).toBeTruthy()
    })

    it.each([1, 2, 3])('[건너뛰기] on step %i saves "done" and goes home without adding anything', async (n) => {
      const user = userEvent.setup()
      const backend = prepare()
      render(<App />)
      await step(1)
      for (let i = 1; i < n; i++) await user.click(screen.getByRole('button', { name: t.next }))
      await step(n)

      await user.click(screen.getByRole('button', { name: t.skip }))

      expect(await home()).toBeTruthy()
      expect(backend.settingsRepo.get('onboarding.done')).toBe(true)
      expect(backend.t.repo.listView('inbox', '2026-03-10')).toHaveLength(0)
    })
  })

  describe('step 1 choices: only real Arms', () => {
    it('lists the registered Arms (an unset Google build dimmed with its reason), the MCP note, and nothing that does not exist', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const google = fakeArm({ manifest: { id: 'google-calendar', name: 'Google 캘린더', auth: 'oauth', scopes: ['x'], capabilities: ['events.read'] } })
      google.availability = () => ({ available: false, reason: ko.home.calendar.notConfigured })
      backend.armManager.register(google)
      backend.armManager.register(backend.obsidianArm)
      backend.armManager.register(fakeArm({ manifest: { id: 'mcp-aaaa1111', name: '내 MCP 서버', auth: 'mcp', capabilities: ['command.tools'] } }))
      render(<App />)
      await step(1)

      const group = await screen.findByRole('group', { name: t.step1.group })
      const buttons = within(group).getAllByRole('button')
      expect(buttons.map((x) => x.querySelector('span')?.textContent)).toEqual(['Google 캘린더', '옵시디언'])
      const googleButton = within(group).getByRole('button', { name: /Google 캘린더/ }) as HTMLButtonElement
      expect(googleButton.disabled).toBe(true)
      expect(googleButton.className).toContain('opacity-55')
      expect(within(googleButton).getByText(ko.home.calendar.notConfigured)).toBeTruthy()
      for (const absent of ['Slack', 'GitHub', 'Microsoft', '노션', 'Notion', 'Gmail', '내 MCP 서버']) expect(screen.queryByText(new RegExp(absent))).toBeNull()
      expect(screen.getByText(t.step1.mcpNote)).toBeTruthy()

      await user.click(googleButton) // 아무 일도 없다
      expect(googleButton.getAttribute('aria-pressed')).toBe('false')
      const obsidian = within(group).getByRole('button', { name: /옵시디언/ })
      await user.click(obsidian)
      expect(obsidian.getAttribute('aria-pressed')).toBe('true')
      await user.click(obsidian)
      expect(obsidian.getAttribute('aria-pressed')).toBe('false')
    })

    it('with no Arm registered at all there is just the note, and the flow still works', async () => {
      const user = userEvent.setup()
      prepare()
      render(<App />)
      await step(1)
      expect(await screen.findByText(t.step1.mcpNote)).toBeTruthy()
      expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: t.next }))
      expect(await step(2)).toBeTruthy()
    })
  })

  describe('step 2: log in (connect) the chosen ones', () => {
    it('shows a [연결] for each chosen Arm; connecting uses the real Arm manager and shows "연결됨"; the next button then says plain "다음"', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.armManager.register(backend.obsidianArm)
      render(<App />)
      await step(1)
      await user.click(await screen.findByRole('button', { name: /옵시디언/ }))
      await user.click(screen.getByRole('button', { name: t.next }))
      await step(2)
      expect(screen.getByRole('button', { name: t.nextLater })).toBeTruthy() // 아직 연결 전

      const list = screen.getByRole('list', { name: t.step2.list })
      await user.click(within(list).getByRole('button', { name: t.step2.connect }))

      expect(await within(list).findByText(t.step2.connected)).toBeTruthy()
      expect(backend.arms.connect).toHaveBeenCalledWith('obsidian')
      expect(backend.armManager.get('obsidian')?.status.state).toBe('on')
      expect(screen.getByRole('button', { name: t.next })).toBeTruthy()
    })

    it('a failed connection shows the reason and [다시 연결]; the user can still move on ("나중에 하고 넘어가기")', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      let fail = true
      backend.armManager.register(
        fakeArm({
          manifest: { id: 'example', name: '예시 도구' },
          connect: async () => {
            if (fail) throw new ArmError('로그인 창이 닫혔어요. 다시 눌러 주세요.')
          }
        })
      )
      render(<App />)
      await step(1)
      await user.click(await screen.findByRole('button', { name: /예시 도구/ }))
      await user.click(screen.getByRole('button', { name: t.next }))
      const list = await screen.findByRole('list', { name: t.step2.list })

      await user.click(within(list).getByRole('button', { name: t.step2.connect }))
      expect((await within(list).findByRole('alert')).textContent).toBe('로그인 창이 닫혔어요. 다시 눌러 주세요.')

      fail = false
      await user.click(within(list).getByRole('button', { name: t.step2.retry }))
      expect(await within(list).findByText(t.step2.connected)).toBeTruthy()
    })

    it('a failure does not stop the flow: later steps and adding the first task still work', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.armManager.register(fakeArm({ manifest: { id: 'example', name: '예시 도구' }, connect: async () => { throw new Error('boom') } }))
      render(<App />)
      await step(1)
      await user.click(await screen.findByRole('button', { name: /예시 도구/ }))
      await user.click(screen.getByRole('button', { name: t.next }))
      await user.click(within(await screen.findByRole('list', { name: t.step2.list })).getByRole('button', { name: t.step2.connect }))
      await screen.findByRole('alert')

      await user.click(screen.getByRole('button', { name: t.nextLater }))
      await step(3)
      await user.type(screen.getByLabelText(ko.tasks.quickInputLabel), '실패해도 할 일은 돼요{Enter}')

      expect(await screen.findByText(t.step3.added('실패해도 할 일은 돼요'))).toBeTruthy()
    })
  })
})

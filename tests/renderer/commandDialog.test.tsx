// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '../../src/main/core/command/llm/types'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { reply, text, use } from '../command/helpers'
import { installBackend, type Backend } from './backend'

const t = ko.command
type User = ReturnType<typeof userEvent.setup>

describe('command dialog (Ctrl+K)', () => {
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

  /** keys=true 면 Anthropic 키가 저장된 상태로 시작한다. 화면을 그리기 전에 준비해 둔다. */
  const prepare = (initial: 'home' | 'inbox' | 'settings' = 'home', keys = true): Backend => {
    b = installBackend(initial)
    if (keys) b.keys.anthropic = 'sk-test-KEY'
    return b
  }
  const show = (): void => void render(<App />)
  const dialog = (): HTMLElement => screen.getByRole('dialog', { name: t.title })
  const input = (): HTMLTextAreaElement => within(dialog()).getByLabelText(t.inputLabel) as HTMLTextAreaElement
  const menu = (): HTMLElement => screen.getByRole('navigation', { name: ko.nav.label })
  const card = (): Promise<HTMLElement> => within(dialog()).findByRole('region', { name: /승인 요청/ })
  const openWithKeys = async (user: User): Promise<void> => {
    await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: t.title })
    await waitFor(() => expect(input().disabled).toBe(false))
  }

  describe('opening and closing', () => {
    it('Ctrl+K opens it from any screen, and Esc closes it', async () => {
      const user = userEvent.setup()
      prepare('settings')
      show()
      await screen.findByRole('heading', { level: 1, name: ko.settings.title })

      await user.keyboard('{Control>}k{/Control}')
      expect(await screen.findByRole('dialog', { name: t.title })).toBeTruthy()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('Cmd+K works too (Mac)', async () => {
      const user = userEvent.setup()
      prepare()
      show()
      await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })

      await user.keyboard('{Meta>}k{/Meta}')

      expect(await screen.findByRole('dialog', { name: t.title })).toBeTruthy()
    })

    it('opens even while typing in another input, and Esc closes it even while typing in its own', async () => {
      const user = userEvent.setup()
      prepare('inbox')
      show()
      const quick = await screen.findByLabelText(ko.tasks.quickInputLabel)
      await user.click(quick)
      await user.keyboard('쓰는 중')

      await user.keyboard('{Control>}k{/Control}')
      expect(await screen.findByRole('dialog', { name: t.title })).toBeTruthy()
      await waitFor(() => expect(input().disabled).toBe(false))
      await user.type(input(), '입력 중이어도')
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('the × button and a click outside close it', async () => {
      const user = userEvent.setup()
      prepare()
      show()
      await openWithKeys(user)

      await user.click(within(dialog()).getByRole('button', { name: t.close }))
      expect(screen.queryByRole('dialog')).toBeNull()

      await user.keyboard('{Control>}k{/Control}')
      await screen.findByRole('dialog')
      await user.click(dialog().parentElement as HTMLElement)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('sending', () => {
    it('Enter sends (new conversation, the chosen model), shows "thinking" with the input locked, then the answer', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.setLlm([reply([text('안녕하세요.\n무엇을 도와드릴까요?')])])
      show()
      await openWithKeys(user)

      const real = backend.command.send.getMockImplementation()!
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      backend.command.send.mockImplementationOnce(async (arg) => {
        await gate
        return real(arg)
      })

      await user.type(input(), '안녕{Enter}')

      expect(backend.command.send).toHaveBeenCalledWith({ conversationId: null, modelId: 'anthropic-opus', text: '안녕' })
      expect(await within(dialog()).findByText(t.thinking)).toBeTruthy()
      expect(input().disabled).toBe(true)
      expect(within(dialog()).getByText('안녕')).toBeTruthy() // 내가 보낸 말은 바로 보인다

      release()
      await waitFor(() => expect(within(dialog()).queryByText(t.thinking)).toBeNull())
      expect(within(dialog()).getByText(/무엇을 도와드릴까요/).textContent).toBe('안녕하세요.\n무엇을 도와드릴까요?')
      expect(input().value).toBe('')
      expect(input().disabled).toBe(false)
    })

    it('Shift+Enter makes a new line and does not send; an empty message is not sent', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await openWithKeys(user)

      await user.type(input(), '{Enter}')
      await user.type(input(), '첫 줄{Shift>}{Enter}{/Shift}둘째 줄')

      expect(backend.command.send).not.toHaveBeenCalled()
      expect(input().value).toBe('첫 줄\n둘째 줄')
    })

    it('Enter while composing Korean (IME) does not send', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await openWithKeys(user)
      await user.type(input(), '안녕')

      fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
      fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 })

      expect(backend.command.send).not.toHaveBeenCalled()
      expect(input().value).toBe('안녕')
    })

    it('shows the model reply as plain text, never as HTML', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const evil = '<img src=x onerror="window.__pwned=1"><b>굵게</b>\n<script>window.__pwned=2</script>'
      backend.setLlm([reply([text(evil)])])
      show()
      await openWithKeys(user)

      await user.type(input(), '해 봐{Enter}')

      const log = await within(dialog()).findByRole('log', { name: t.conversationLabel })
      await waitFor(() => expect(log.textContent).toContain('<b>굵게</b>'))
      expect(log.querySelector('img, b, script')).toBeNull()
      expect((window as { __pwned?: number }).__pwned).toBeUndefined()
    })

    it('a read-only tool shows as one folded line, not its raw result', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.t.repo.create({ title: '비밀 제목 ABC' })
      backend.setLlm([reply([use('r1', 'list_tasks', { view: 'inbox' })], 'tool_use'), reply([text('수신함에 하나 있어요.')])])
      show()
      await openWithKeys(user)

      await user.type(input(), '수신함 보여줘{Enter}')

      expect(await within(dialog()).findByText(/할 일 목록을 봤어요/)).toBeTruthy()
      expect(within(dialog()).getByText('수신함에 하나 있어요.')).toBeTruthy()
      expect(dialog().textContent).not.toContain('<data')
      expect(dialog().textContent).not.toContain('비밀 제목 ABC')
    })
  })

  describe('approval cards', () => {
    const askToAdd = async (user: User, backend: Backend): Promise<void> => {
      backend.setLlm([reply([text('추가할게요.'), use('w1', 'add_task', { text: '내일 치과 예약' })], 'tool_use'), reply([text('추가했어요.')])])
      await openWithKeys(user)
      await user.type(input(), '내일 치과 예약 추가해줘{Enter}')
      await card()
    }

    it('a write tool stops at a card (tool name, source, preview) and nothing is written yet', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await askToAdd(user, backend)

      const c = await card()
      expect(within(c).getByText(t.toolLabels.add_task)).toBeTruthy()
      expect(within(c).getByText(t.sources.core)).toBeTruthy()
      expect(within(c).getByText('할 일 추가: 치과 예약')).toBeTruthy()
      expect(within(c).getByRole('button', { name: t.approve })).toBeTruthy()
      expect(within(c).getByRole('button', { name: t.reject })).toBeTruthy()
      expect(within(dialog()).getByText(t.approvalHint)).toBeTruthy()
      expect(backend.t.repo.listView('upcoming', '2026-03-10')).toHaveLength(0)
      expect(backend.command.decide).not.toHaveBeenCalled()
    })

    it('[실행] sends the approval, writes, shows the result and the next answer, and announces the data change', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const changed = vi.fn()
      window.addEventListener('octopus:data-changed', changed)
      show()
      await askToAdd(user, backend)
      const sent = (await backend.command.send.mock.results[0].value) as { ok: true; data: { conversationId: string } }

      await user.click(within(dialog()).getByRole('button', { name: t.approve }))

      expect(await within(dialog()).findByText('추가했어요.')).toBeTruthy()
      expect(backend.command.decide).toHaveBeenCalledWith(sent.data.conversationId, [{ callId: 'w1', approve: true }])
      expect(within(dialog()).getByText(/할 일 추가 완료/)).toBeTruthy()
      expect(within(dialog()).queryByRole('region', { name: /승인 요청/ })).toBeNull()
      expect(backend.t.repo.listView('upcoming', '2026-03-10').map((x) => x.title)).toEqual(['치과 예약'])
      expect(changed).toHaveBeenCalledTimes(1)
      window.removeEventListener('octopus:data-changed', changed)
    })

    it('[거절] writes nothing and does not announce a data change', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.setLlm([reply([use('w1', 'add_task', { text: '버릴 일' })], 'tool_use'), reply([text('알겠어요.')])])
      const changed = vi.fn()
      window.addEventListener('octopus:data-changed', changed)
      show()
      await openWithKeys(user)
      await user.type(input(), '추가{Enter}')
      await card()

      await user.click(within(dialog()).getByRole('button', { name: t.reject }))

      expect(await within(dialog()).findByText('알겠어요.')).toBeTruthy()
      expect(backend.command.decide.mock.calls[0][1]).toEqual([{ callId: 'w1', approve: false }])
      expect(within(dialog()).getByText(/할 일 추가 거절함/)).toBeTruthy()
      expect(backend.t.repo.listView('inbox', '2026-03-10')).toHaveLength(0)
      expect(changed).not.toHaveBeenCalled()
      window.removeEventListener('octopus:data-changed', changed)
    })

    it('sending a new message while a card is open rejects that card', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await askToAdd(user, backend)
      backend.setLlm([reply([text('그냥 말만 할게요.')])])

      await user.type(input(), '아니 취소{Enter}')

      expect(await within(dialog()).findByText('그냥 말만 할게요.')).toBeTruthy()
      expect(within(dialog()).queryByRole('region', { name: /승인 요청/ })).toBeNull()
      expect(within(dialog()).getByText(/할 일 추가 거절함/)).toBeTruthy()
      expect(backend.t.repo.listView('upcoming', '2026-03-10')).toHaveLength(0)
      expect(backend.command.decide).not.toHaveBeenCalled() // 새 말이 곧 거절이다
    })

    it('after a write, the tasks list behind the dialog shows the new task', async () => {
      const user = userEvent.setup()
      const backend = prepare('inbox')
      backend.setLlm([reply([use('w1', 'add_task', { text: '보고서 제출' })], 'tool_use'), reply([text('됐어요.')])])
      show()
      await screen.findByLabelText(ko.tasks.quickInputLabel)
      await user.keyboard('{Control>}k{/Control}')
      await screen.findByRole('dialog')
      await waitFor(() => expect(input().disabled).toBe(false))
      await user.type(input(), '추가{Enter}')
      await card()
      await user.click(within(dialog()).getByRole('button', { name: t.approve }))
      await within(dialog()).findByText('됐어요.')

      await user.keyboard('{Escape}')

      expect(await screen.findByText('보고서 제출')).toBeTruthy()
    })
  })

  describe('errors', () => {
    it.each([
      ['auth', t.errors.auth],
      ['rate_limit', t.errors.rate_limit],
      ['network', t.errors.network],
      ['overloaded', t.errors.overloaded],
      ['bad_request', t.errors.bad_request]
    ] as const)('%s shows its own next-step message', async (kind, message) => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.setLlm([new LlmError(kind, 'x')])
      show()
      await openWithKeys(user)

      await user.type(input(), '안녕{Enter}')

      expect((await within(dialog()).findByRole('alert')).textContent).toBe(message)
      expect(input().disabled).toBe(false) // 다시 보낼 수 있다
    })

    it('a refusal and a truncated answer have their own messages', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.setLlm([reply([text('안 돼요')], 'refusal')])
      show()
      await openWithKeys(user)
      await user.type(input(), '하나{Enter}')
      expect((await within(dialog()).findByRole('alert')).textContent).toBe(t.errors.refusal)

      backend.setLlm([reply([text('잘린 답')], 'max_tokens')])
      await user.type(input(), '둘{Enter}')
      await waitFor(() => expect(within(dialog()).getByRole('alert').textContent).toBe(t.errors.too_long))
    })

    it('no_key (key removed while the window was open) offers "모델 연결하기", which goes to settings', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      show()
      await openWithKeys(user)
      delete backend.keys.anthropic

      await user.type(input(), '안녕{Enter}')
      const alert = await within(dialog()).findByRole('alert')
      expect(alert.textContent).toContain(t.errors.no_key)
      await user.click(within(alert).getByRole('button', { name: t.noKey.button }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await screen.findByRole('heading', { level: 1, name: ko.settings.title })).toBeTruthy()
    })

    it('without any key the window explains how to connect, locks the input, and the rest of the app works', async () => {
      const user = userEvent.setup()
      const backend = prepare('home', false)
      show()
      await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })

      await user.keyboard('{Control>}k{/Control}')

      const d = await screen.findByRole('dialog', { name: t.title })
      expect(await within(d).findByText(t.noKey.title)).toBeTruthy()
      expect(input().disabled).toBe(true)
      await user.click(within(d).getByRole('button', { name: t.noKey.button }))
      expect(await screen.findByRole('heading', { level: 1, name: ko.settings.title })).toBeTruthy()
      expect(backend.command.send).not.toHaveBeenCalled()

      await user.click(within(menu()).getByRole('button', { name: ko.nav.tasks }))
      expect(await screen.findByLabelText(ko.tasks.quickInputLabel)).toBeTruthy()
    })
  })

  describe('conversations', () => {
    it('lists recent conversations, opens one, starts a new one, and deletes after confirming', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.setLlm([reply([text('첫 답')]), reply([text('둘째 답')])])
      show()
      await openWithKeys(user)
      await user.type(input(), '첫 번째 질문{Enter}')
      await within(dialog()).findByText('첫 답')

      await user.click(within(dialog()).getByRole('button', { name: t.newChat }))
      expect(within(dialog()).queryByText('첫 답')).toBeNull()
      await user.type(input(), '두 번째 질문{Enter}')
      await within(dialog()).findByText('둘째 답')
      const list = within(dialog()).getByRole('complementary', { name: t.chatsLabel })
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)

      await user.click(within(list).getByRole('button', { name: '첫 번째 질문' }))
      expect(await within(dialog()).findByText('첫 답')).toBeTruthy()
      expect(within(dialog()).queryByText('둘째 답')).toBeNull()

      await user.click(within(list).getByRole('button', { name: t.deleteChat('첫 번째 질문') }))
      expect(backend.command.removeConversation).not.toHaveBeenCalled() // 확인 전에는 지우지 않는다
      await user.click(within(list).getByRole('button', { name: t.deleteYes }))
      await waitFor(() => expect(backend.command.removeConversation).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
    })
  })

  describe('entry points', () => {
    it('left menu: dimmed without a model but still opens the window (which explains)', async () => {
      const user = userEvent.setup()
      prepare('home', false)
      show()
      await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })
      const button = within(menu()).getByRole('button', { name: ko.nav.command })
      expect(button.className).toContain('opacity-45')

      await user.click(button)

      expect(await within(await screen.findByRole('dialog')).findByText(t.noKey.title)).toBeTruthy()
    })

    it('left menu: normal when a key is saved', async () => {
      prepare('home', true)
      show()
      await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })

      await waitFor(() => expect(within(menu()).getByRole('button', { name: ko.nav.command }).className).not.toContain('opacity-45'))
    })

    it('pie menu: the 지시하기 wedge is disabled without a model', async () => {
      const user = userEvent.setup()
      prepare('home', false)
      show()

      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))

      const wedge = within(await screen.findByRole('menu')).getAllByRole('menuitem')[0]
      expect(wedge.getAttribute('aria-label')).toBe(ko.pie.labels.command)
      expect(wedge.getAttribute('aria-disabled')).toBe('true')
    })

    it('pie menu: with a key the 지시하기 wedge is enabled and opens the window', async () => {
      const user = userEvent.setup()
      prepare('home', true)
      show()
      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
      const wedge = (): HTMLElement => within(screen.getByRole('menu')).getAllByRole('menuitem')[0]
      await waitFor(() => expect(wedge().getAttribute('aria-disabled')).toBeNull())

      await user.click(wedge())

      expect(await screen.findByRole('dialog', { name: t.title })).toBeTruthy()
    })
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest, ChatResponse, LlmAdapter } from '../../src/main/core/command/llm/types'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { reply, text } from '../command/helpers'
import { installBackend, type Backend } from './backend'

const t = ko.command
const CONVERSATION = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

/** 화면 시험용 가짜 모델: 조각을 시험이 원하는 때에 흘려보내고, 끝내는 것도 시험이 정한다. 멈추면 그때까지의 글만 돌려준다. */
function manualModel() {
  const state: { request?: ChatRequest; started: boolean; got: string } = { started: false, got: '' }
  let finish!: (response: ChatResponse) => void
  const adapter: LlmAdapter = {
    chat(request) {
      state.request = request
      state.started = true
      return new Promise<ChatResponse>((resolve) => {
        finish = resolve
        request.signal?.addEventListener('abort', () => resolve({ content: state.got === '' ? [] : [text(state.got)], stopReason: 'other', usage: { inputTokens: 0, outputTokens: 0 }, aborted: true }))
      })
    }
  }
  return {
    adapter,
    state,
    /** 글 조각을 화면으로 흘려보낸다(진짜 어댑터의 onText 와 같다). */
    push: (piece: string): void => {
      state.got += piece
      state.request?.onText?.(piece)
    },
    finish: (response: ChatResponse): void => finish(response)
  }
}

describe('command dialog: streaming and stop', () => {
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

  const dialog = (): HTMLElement => screen.getByRole('dialog', { name: t.title })
  const input = (): HTMLTextAreaElement => within(dialog()).getByLabelText(t.inputLabel) as HTMLTextAreaElement
  const log = (): HTMLElement => within(dialog()).getByRole('log', { name: t.conversationLabel })
  const bubble = (): HTMLElement => within(dialog()).getByTestId('streaming-bubble')

  /** 대화창을 열고 한 마디 보낸 뒤, 모델이 요청을 받을 때까지 기다린다. */
  async function startSending(model: ReturnType<typeof manualModel>, user = userEvent.setup()): Promise<void> {
    b = installBackend('home')
    b.keys.anthropic = 'sk-test-KEY'
    b.setAdapter(model.adapter)
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: t.title })
    await waitFor(() => expect(input().disabled).toBe(false))
    await user.type(input(), '오늘 할 일 알려줘{Enter}')
    await waitFor(() => expect(model.state.started).toBe(true))
  }

  it('shows "생각 중…" until the first piece, then the piece appears in a bubble', async () => {
    const model = manualModel()
    await startSending(model)

    expect(within(dialog()).getByText(t.thinking)).toBeTruthy()
    expect(within(dialog()).queryByTestId('streaming-bubble')).toBeNull()

    act(() => model.push('오늘은'))

    expect(bubble().textContent).toBe('오늘은')
    expect(within(dialog()).queryByText(t.thinking)).toBeNull()
  })

  it('pieces are added onto the same bubble; the final result replaces the bubble with the finished answer (no duplicate)', async () => {
    const model = manualModel()
    await startSending(model)

    act(() => model.push('오늘은 '))
    act(() => model.push('할 일이 '))
    act(() => model.push('없어요.'))
    expect(bubble().textContent).toBe('오늘은 할 일이 없어요.')

    await act(async () => model.finish(reply([text('오늘은 할 일이 없어요.')])))

    await waitFor(() => expect(within(dialog()).queryByTestId('streaming-bubble')).toBeNull())
    expect(within(log()).getAllByText('오늘은 할 일이 없어요.')).toHaveLength(1)
    expect(within(dialog()).queryByText(t.stop)).toBeNull()
  })

  it('shows [중지] in place of [보내기] while sending, and puts [보내기] back afterwards', async () => {
    const model = manualModel()
    await startSending(model)

    expect(within(dialog()).getByRole('button', { name: t.stop })).toBeTruthy()
    expect(within(dialog()).queryByRole('button', { name: t.send })).toBeNull()

    await act(async () => model.finish(reply([text('끝')])))

    expect(await within(dialog()).findByRole('button', { name: t.send })).toBeTruthy()
    expect(within(dialog()).queryByRole('button', { name: t.stop })).toBeNull()
  })

  it('[중지] stops the request: the text received so far stays, marked "(중지됨)", and a new message can be sent', async () => {
    const user = userEvent.setup()
    const model = manualModel()
    await startSending(model, user)
    act(() => model.push('반쯤 쓴 '))
    act(() => model.push('답'))

    await user.click(within(dialog()).getByRole('button', { name: t.stop }))

    expect(b.command.cancel).toHaveBeenCalledTimes(1)
    expect((await within(log()).findByText(/반쯤 쓴 답/)).textContent).toBe('반쯤 쓴 답\n\n(중지됨)')
    expect(within(dialog()).queryByTestId('streaming-bubble')).toBeNull()
    expect(within(dialog()).queryByRole('alert')).toBeNull() // 중지는 오류가 아니다
    await waitFor(() => expect(input().disabled).toBe(false))
    expect(within(dialog()).getByRole('button', { name: t.send })).toBeTruthy()
  })

  it('closing the dialog while it is sending stops the request too', async () => {
    const user = userEvent.setup()
    const model = manualModel()
    await startSending(model, user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.command.cancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(model.state.request?.signal?.aborted).toBe(true))
  })

  it('Esc still just closes the window when nothing is running (no stop request)', async () => {
    b = installBackend('home')
    b.keys.anthropic = 'sk-test-KEY'
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: t.title })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.command.cancel).not.toHaveBeenCalled()
  })

  it('a refusal swaps the streamed text for the notice (replace)', async () => {
    const model = manualModel()
    await startSending(model)
    act(() => model.push('이미 흘려보낸 글'))
    expect(bubble().textContent).toBe('이미 흘려보낸 글')

    act(() => b.emitCommandEvent({ conversationId: CONVERSATION, kind: 'replace', reason: 'refusal' }))

    expect(bubble().textContent).toBe(t.refusalReplaced)
    expect(within(dialog()).queryByText('이미 흘려보낸 글')).toBeNull()
  })

  it('a finished refusal leaves no partial text, only the notice for the error', async () => {
    const model = manualModel()
    await startSending(model)
    act(() => model.push('부분 글'))

    await act(async () => model.finish(reply([text('부분 글')], 'refusal')))

    expect((await within(dialog()).findByRole('alert')).textContent).toContain(t.errors.refusal)
    expect(within(dialog()).queryByText('부분 글')).toBeNull()
    expect(within(dialog()).queryByTestId('streaming-bubble')).toBeNull()
  })

  it('shows what a read-only tool is doing ("할 일 목록을 보는 중…") and goes back to the text when it continues', async () => {
    const model = manualModel()
    await startSending(model)
    act(() => model.push('확인할게요.'))

    act(() => b.emitCommandEvent({ conversationId: CONVERSATION, kind: 'tool', name: 'list_tasks' }))
    expect(within(dialog()).getByText(t.runningLines.list_tasks)).toBeTruthy()

    act(() => model.push('네 개예요.'))
    expect(within(dialog()).queryByText(t.runningLines.list_tasks)).toBeNull()
    expect(bubble().textContent).toBe('확인할게요.\n\n네 개예요.') // 도구 뒤의 글은 새 문단으로
  })

  it('an unknown tool name still gets a plain "…읽는 중" line', async () => {
    const model = manualModel()
    await startSending(model)

    act(() => b.emitCommandEvent({ conversationId: CONVERSATION, kind: 'tool', name: 'weird_tool' }))

    expect(within(dialog()).getByText(t.runningFallback('weird_tool'))).toBeTruthy()
  })

  it('model text is only shown as letters: HTML-looking text creates no elements', async () => {
    const model = manualModel()
    await startSending(model)

    act(() => model.push('<img src=x onerror="alert(1)"> <b>굵게</b> <script>x</script>'))

    expect(bubble().textContent).toBe('<img src=x onerror="alert(1)"> <b>굵게</b> <script>x</script>')
    for (const tag of ['img', 'b', 'script']) expect(bubble().querySelector(tag)).toBeNull()
    expect(dialog().querySelector('img')).toBeNull()
  })

  describe('auto-scroll', () => {
    /** jsdom 에는 레이아웃이 없어서 스크롤 크기를 직접 정한다. */
    function fakeScroll(element: HTMLElement): { top: () => number; setTop: (value: number) => void } {
      let top = 0
      Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: 200 })
      Object.defineProperty(element, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = value) })
      return { top: () => top, setTop: (value) => void (top = value) }
    }

    it('follows the bottom while pieces arrive, stops when the user scrolls up, and follows again at the bottom', async () => {
      const model = manualModel()
      await startSending(model)
      const scroll = fakeScroll(log())

      act(() => model.push('첫 조각 '))
      expect(scroll.top()).toBe(1000) // 맨 아래를 따라간다

      scroll.setTop(100) // 사용자가 위로 올려 읽는 중
      fireEvent.scroll(log())
      act(() => model.push('둘째 조각 '))
      expect(scroll.top()).toBe(100) // 따라가지 않는다

      scroll.setTop(800) // 다시 맨 아래(1000 - 800 - 200 = 0)
      fireEvent.scroll(log())
      act(() => model.push('셋째 조각'))
      expect(scroll.top()).toBe(1000)
    })

    it('sending a new message jumps back to the bottom even if the user had scrolled up', async () => {
      const user = userEvent.setup()
      const model = manualModel()
      await startSending(model, user)
      const scroll = fakeScroll(log())
      scroll.setTop(50)
      fireEvent.scroll(log())
      await act(async () => model.finish(reply([text('끝났어요')])))
      await waitFor(() => expect(input().disabled).toBe(false))
      b.setAdapter(manualModel().adapter)

      await user.type(input(), '또 물어요{Enter}')

      await waitFor(() => expect(scroll.top()).toBe(1000))
    })
  })

  it('works through a real session too: the screen shows the stream that the session sends as events', async () => {
    b = installBackend('home')
    b.keys.anthropic = 'sk-test-KEY'
    const streamed: LlmAdapter = {
      async chat(request) {
        request.onText?.('세션이 ')
        request.onText?.('보낸 글')
        await new Promise((resolve) => setTimeout(resolve, 30))
        return reply([text('세션이 보낸 글')])
      }
    }
    b.setAdapter(streamed)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '3월 10일 화요일' })
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: t.title })
    await waitFor(() => expect(input().disabled).toBe(false))

    await user.type(input(), '안녕{Enter}')

    expect((await within(dialog()).findByTestId('streaming-bubble')).textContent).toContain('세션이')
    expect(await within(log()).findByText('세션이 보낸 글')).toBeTruthy()
    await waitFor(() => expect(within(dialog()).queryByTestId('streaming-bubble')).toBeNull())
  })
})

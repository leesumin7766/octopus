// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// 시연에서 발견: 작은 창에서 홈 '오늘 할 일' 카드의 입력 도움말("알아들은 것")이 목록 자리를 차지했다.
// 홈 카드와 할 일 화면 모두 입력을 시작했을 때만 도움말 줄을 보인다.

describe('quick input hint on the home today card', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  it('the home card hides the hint row until something is typed, so the list keeps its space', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.t.repo.create({ title: '보고서', date: '2026-11-25' })
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    await within(card).findByText('보고서')

    expect(within(card).queryByText(ko.tasks.parsedLabel)).toBeNull()
    expect(within(card).queryByText(ko.tasks.parseHint)).toBeNull()

    await user.type(within(card).getByLabelText(ko.tasks.quickInputLabel), '내일 3시 회의')
    expect(await within(card).findByText(ko.tasks.parsedLabel)).toBeTruthy()

    await user.clear(within(card).getByLabelText(ko.tasks.quickInputLabel))
    expect(within(card).queryByText(ko.tasks.parsedLabel)).toBeNull()
  })

  it('the tasks screen also shows the hint row only while typing (less text on screen)', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    render(<App />)
    const input = await screen.findByLabelText(ko.tasks.quickInputLabel)
    expect(screen.queryByText(ko.tasks.parsedLabel)).toBeNull()
    await user.type(input, '내일 3시 회의')
    expect(await screen.findByText(ko.tasks.parsedLabel)).toBeTruthy()
  })
})

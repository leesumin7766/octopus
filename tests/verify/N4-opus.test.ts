// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// N4 독립 검증(Opus): 여러 줄 메모 입력(메모 화면 새 메모·편집, 원형 메뉴 메모 추가)은 같은 키·같은 모양, 한 줄(홈 카드)은 Enter 저장.
import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

let b: Backend
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  b = installBackend('home')
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

const nav = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name }))

/** 여러 줄 칸의 공통 모양: 이름이 있고, placeholder 에 키 안내가 없고, 같은 줄에 [저장] 과 키 안내가 늘 보인다. */
function expectStandardMultiline(box: HTMLTextAreaElement): void {
  expect(box.tagName).toBe('TEXTAREA')
  expect(box.getAttribute('aria-label')).toBeTruthy()
  expect(box.getAttribute('placeholder') ?? '').not.toMatch(/Enter|Ctrl|Cmd/)
  const wrap = box.parentElement as HTMLElement
  expect(within(wrap).getByRole('button', { name: ko.multiline.save })).toBeTruthy()
  expect(within(wrap).getByText(ko.multiline.keyHint)).toBeTruthy()
}

async function memoScreen(user: ReturnType<typeof userEvent.setup>): Promise<HTMLTextAreaElement> {
  render(createElement(App))
  await screen.findByRole('region', { name: ko.home.cards.todo })
  await nav(user, ko.nav.memos)
  return (await screen.findByLabelText(ko.memos.newLabel)) as HTMLTextAreaElement
}

describe('N4 (Opus)', () => {
  it('memo screen new memo: Enter and Shift+Enter make new lines, Ctrl+Enter saves once', async () => {
    const user = userEvent.setup()
    const box = await memoScreen(user)
    expectStandardMultiline(box)
    await user.type(box, '첫 줄{Enter}둘째 줄{Shift>}{Enter}{/Shift}셋째 줄')
    expect(b.memos.create).not.toHaveBeenCalled()
    expect(box.value).toBe('첫 줄\n둘째 줄\n셋째 줄')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(b.memos.create).toHaveBeenCalledTimes(1))
    expect(b.memos.create.mock.calls[0][0]).toBe('첫 줄\n둘째 줄\n셋째 줄')
  })

  it('Ctrl+Enter while Korean input is composing does not save', async () => {
    const user = userEvent.setup()
    const box = await memoScreen(user)
    await user.type(box, '한글')
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, keyCode: 229 })
    expect(b.memos.create).not.toHaveBeenCalled()
  })

  it('memo screen edit uses the same input and Cmd+Enter saves', async () => {
    const user = userEvent.setup()
    const memo = b.memoRepo.create('고칠 메모')
    await memoScreen(user)
    await user.click(await screen.findByRole('button', { name: `${ko.memos.edit}: 고칠 메모` }))
    const edit = (await screen.findByLabelText(ko.memos.editLabel)) as HTMLTextAreaElement
    expectStandardMultiline(edit)
    await user.type(edit, '!')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(b.memos.update).toHaveBeenCalledWith(memo.id, '고칠 메모!'))
  })

  it('pie menu memo dialog: same input; Enter alone does not save, the [저장] button does', async () => {
    const user = userEvent.setup()
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(screen.getByRole('button', { name: ko.pie.menuLabel }))
    await user.click(await screen.findByRole('menuitem', { name: '메모 추가' }))
    const dialog = await screen.findByRole('dialog')
    const box = within(dialog).getByRole('textbox') as HTMLTextAreaElement
    expectStandardMultiline(box)
    await user.type(box, '대화상자 메모{Enter}')
    expect(b.memos.create).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: ko.multiline.save }))
    await waitFor(() => expect(b.memos.create).toHaveBeenCalledTimes(1))
  })

  it('home memo card stays a one-line input where Enter saves', async () => {
    const user = userEvent.setup()
    render(createElement(App))
    const card = await screen.findByRole('region', { name: ko.home.cards.memo })
    const line = within(card).getByRole('textbox') as HTMLInputElement
    expect(line.tagName).toBe('INPUT')
    await user.type(line, '한 줄 메모{Enter}')
    await waitFor(() => expect(b.memos.create).toHaveBeenCalledTimes(1))
  })
})

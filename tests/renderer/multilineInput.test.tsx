// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { MultilineInput } from '../../src/renderer/ui/MultilineInput'
import { installBackend, type Backend } from './backend'

// N4: 여러 줄 입력(메모 화면의 새 메모·편집, 원형 메뉴의 메모 추가)은 Enter 줄바꿈 · Ctrl/Cmd+Enter 저장 · 늘 보이는 [저장]·키 안내.
// 한 줄 입력(홈 메모 카드)은 Enter 저장.
const t = ko.memos

describe('MultilineInput', () => {
  afterEach(cleanup)

  function Harness({ onSave }: { onSave: () => void }) {
    const [value, setValue] = useState('')
    return <MultilineInput value={value} onChange={setValue} onSave={onSave} label="입력" saveDisabled={value.trim() === ''} />
  }

  it('Enter is a new line; Ctrl+Enter and Cmd+Enter save; the button and the key hint are always shown', async () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    const box = screen.getByRole('textbox', { name: '입력' })
    expect(screen.getByText(ko.multiline.keyHint)).toBeTruthy()
    expect((screen.getByRole('button', { name: ko.multiline.save }) as HTMLButtonElement).disabled).toBe(true)

    await userEvent.type(box, '첫 줄{Enter}둘째 줄')
    expect((box as HTMLTextAreaElement).value).toBe('첫 줄\n둘째 줄')
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSave).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: ko.multiline.save }))
    expect(onSave).toHaveBeenCalledTimes(3)
  })

  it('the key hint says ⌘ on a Mac and Ctrl otherwise', () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')
    try {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
      render(<Harness onSave={vi.fn()} />)
      expect(screen.getByText(ko.multiline.keyHintMac)).toBeTruthy()
      expect(screen.queryByText(ko.multiline.keyHint)).toBeNull()
      cleanup()
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
      render(<Harness onSave={vi.fn()} />)
      expect(screen.getByText(ko.multiline.keyHint)).toBeTruthy()
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['platform']
      if (original) Object.defineProperty(Navigator.prototype, 'platform', original)
    }
  })

  it('Ctrl+Enter during Korean composition does not save', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    const box = screen.getByRole('textbox', { name: '입력' })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, keyCode: 229 })
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('the three memo inputs follow the standard', () => {
  let b: Backend

  afterEach(() => {
    cleanup()
    b?.t.db.close()
  })

  it('memo screen: new memo is multi-line with a named box, no key hint in the placeholder, visible hint and [저장]', async () => {
    const user = userEvent.setup()
    b = installBackend('memos')
    render(<App />)
    const box = (await screen.findByRole('textbox', { name: t.newLabel })) as HTMLTextAreaElement
    expect(box.placeholder).not.toMatch(/Enter/)
    expect(screen.getAllByText(ko.multiline.keyHint).length).toBeGreaterThan(0)

    await user.type(box, '첫 줄{Enter}둘째 줄')
    expect(box.value).toBe('첫 줄\n둘째 줄')
    expect(b.memos.create).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(b.memos.create).toHaveBeenCalledWith('첫 줄\n둘째 줄'))
  })

  it('memo screen: editing uses the same input (Cmd+Enter saves, Esc leaves, [저장]·[취소] shown)', async () => {
    const user = userEvent.setup()
    b = installBackend('memos')
    const memo = b.memoRepo.create('고칠 메모')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: new RegExp(`^${t.edit}: 고칠 메모`) }))
    const box = (await screen.findByRole('textbox', { name: t.editLabel })) as HTMLTextAreaElement
    const row = box.closest('li') as HTMLElement
    expect(within(row).getByRole('button', { name: ko.multiline.save })).toBeTruthy()
    expect(within(row).getByRole('button', { name: t.cancel })).toBeTruthy()
    await user.type(box, '{Enter}더')
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(b.memos.update).toHaveBeenCalledWith(memo.id, '고칠 메모\n더'))
  })

  it('pie-menu memo dialog: same keys, visible hint and [저장]; Enter does not save', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.memo })
    // 원형 메뉴를 거치지 않고 같은 대화상자를 연다: 홈 키보드 흐름과 같은 진입(메뉴 → 메모 추가)
    await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
    await user.click(await screen.findByRole('menuitem', { name: ko.pie.labels['memo:quickAdd'] }))
    const dialog = await screen.findByRole('dialog', { name: ko.home.dialogs.memoTitle })
    const box = within(dialog).getByRole('textbox', { name: ko.home.dialogs.memoLabel }) as HTMLTextAreaElement
    expect((box as HTMLTextAreaElement).placeholder).not.toMatch(/Ctrl|Enter/)
    expect(within(dialog).getByText(ko.multiline.keyHint)).toBeTruthy()
    await user.type(box, '대화상자 메모{Enter}둘째')
    expect(b.memos.create).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(b.memos.create).toHaveBeenCalledWith('대화상자 메모\n둘째'))
  })

  it('home memo card: one line, Enter saves', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.memo })
    const input = within(card).getByLabelText(ko.home.memo.quickLabel)
    expect(input.tagName).toBe('INPUT')
    await user.type(input, '한 줄 메모{Enter}')
    await waitFor(() => expect(b.memos.create).toHaveBeenCalledWith('한 줄 메모'))
  })
})

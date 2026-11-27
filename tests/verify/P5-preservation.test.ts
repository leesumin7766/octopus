/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
let MemoCard: ComponentType
let MemoQuickDialog: ComponentType<{ onClose: () => void; onSaved: (remaining: string) => void }>
beforeAll(async () => {
  const cardPath = '../../src/renderer/home/cards/MemoCard'
  const dialogPath = '../../src/renderer/home/QuickDialogs'
  MemoCard = (await import(cardPath)).MemoCard
  MemoQuickDialog = (await import(dialogPath)).MemoQuickDialog
})
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

describe('P5 independent input preservation', () => {
  let b: Backend
  beforeEach(() => { b = installBackend() })
  afterEach(() => { cleanup(); b.t.db.close() })

  function delaySave() {
    const real = b.memos.create.getMockImplementation()!
    let release!: () => void
    b.memos.create.mockImplementation((body) => new Promise((resolve) => {
      release = () => { void real(body).then(resolve) }
    }))
    return () => release()
  }

  it('retains the entire changed home draft, not only its suffix', async () => {
    const release = delaySave()
    render(createElement(MemoCard))
    await screen.findByText(ko.home.memo.empty)
    const box = screen.getByLabelText(ko.home.memo.quickLabel) as HTMLInputElement
    fireEvent.change(box, { target: { value: '회의 메모' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.memos.create).toHaveBeenCalledTimes(1)
    fireEvent.change(box, { target: { value: '회의 메모  이어 쓰는 내용' } })
    await act(async () => release())
    await screen.findByText('회의 메모')
    expect(box.value).toBe('회의 메모  이어 쓰는 내용')
  })

  it('does not trim or discard the multiline dialog draft changed during saving', async () => {
    const release = delaySave()
    const onSaved = vi.fn()
    render(createElement(MemoQuickDialog, { onClose: vi.fn(), onSaved }))
    const box = screen.getByLabelText(ko.home.dialogs.memoLabel) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '첫 문단' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    fireEvent.change(box, { target: { value: '첫 문단\n\n  다음 문단' } })
    await act(async () => release())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(box.value).toBe('첫 문단\n\n  다음 문단')
  })
})


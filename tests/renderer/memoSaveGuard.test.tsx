// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcError } from '../../src/shared/ipc'
import { ko } from '../../src/renderer/i18n/ko'
import { MemoCard } from '../../src/renderer/home/cards/MemoCard'
import { MemoQuickDialog } from '../../src/renderer/home/QuickDialogs'
import { MemosScreen } from '../../src/renderer/memos/MemosScreen'
import { installBackend, type Backend } from './backend'

const t = ko.memos
const card = ko.home.memo
const dialog = ko.home.dialogs

/** 저장 요청(spy)을 붙잡아 둔다. release() 가 불리면 진짜 핸들러 결과로 끝내고, failure 가 있으면 그 실패로 끝낸다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SaveSpy = { getMockImplementation(): Function | undefined; mockImplementation(fn: (...args: any[]) => Promise<any>): unknown }
function holdSave(spy: SaveSpy, failure?: IpcError): { release: () => void } {
  const real = spy.getMockImplementation()
  if (!real) throw new Error('진짜 구현이 없다')
  let finish: () => void = () => {}
  spy.mockImplementation((...args) => new Promise((resolve) => {
    finish = () => resolve(failure ? { ok: false, error: failure } : real(...args))
  }))
  return { release: () => finish() }
}
const internalError = { code: 'internal' } as IpcError

describe('save guard: home memo card', () => {
  let b: Backend

  beforeEach(() => {
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
  })

  const renderCard = async (): Promise<HTMLInputElement> => {
    render(<MemoCard />)
    await screen.findByText(card.empty)
    return screen.getByLabelText(card.quickLabel) as HTMLInputElement
  }

  it('Enter spam during a slow save calls create once', async () => {
    const save = holdSave(b.memos.create)
    const box = await renderCard()
    fireEvent.change(box, { target: { value: '빵 사 오기' } })

    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.memos.create).toHaveBeenCalledTimes(1)

    save.release()
    expect(await screen.findByText('빵 사 오기')).toBeTruthy()
    expect(b.memos.create).toHaveBeenCalledTimes(1)
    expect(box.value).toBe('')
  })

  it('text typed while the save is pending survives a successful save', async () => {
    const save = holdSave(b.memos.create)
    const box = await renderCard()
    fireEvent.change(box, { target: { value: '첫 메모' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    fireEvent.change(box, { target: { value: '첫 메모 이어서' } })
    save.release()

    expect(await screen.findByText('첫 메모')).toBeTruthy()
    expect(box.value).toBe('첫 메모 이어서')
  })

  it('keeps the input and shows the error when saving fails', async () => {
    const save = holdSave(b.memos.create, internalError)
    const box = await renderCard()
    fireEvent.change(box, { target: { value: '지키고 싶은 글' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    save.release()

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(box.value).toBe('지키고 싶은 글')
  })
})

describe('save guard: memos screen', () => {
  let b: Backend

  beforeEach(() => {
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
  })

  const renderScreen = async (): Promise<void> => {
    render(<MemosScreen searchDebounceMs={0} />)
    await screen.findByLabelText(t.newLabel)
  }
  const input = (): HTMLTextAreaElement => screen.getByLabelText(t.newLabel) as HTMLTextAreaElement
  const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: t.save }) as HTMLButtonElement
  const ctrlEnter = (el: HTMLElement): void => {
    fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
  }

  it('Ctrl+Enter and button spam during a slow save call create once, and the button is disabled', async () => {
    const save = holdSave(b.memos.create)
    await renderScreen()
    fireEvent.change(input(), { target: { value: '장보기' } })

    ctrlEnter(input())
    ctrlEnter(input())
    fireEvent.click(saveButton())
    fireEvent.click(saveButton())
    expect(saveButton().disabled).toBe(true)
    expect(b.memos.create).toHaveBeenCalledTimes(1)

    save.release()
    expect(await screen.findByText('장보기')).toBeTruthy()
    await waitFor(() => expect(saveButton().disabled).toBe(true)) // 칸이 비어서 비활성
    expect(b.memos.create).toHaveBeenCalledTimes(1)
  })

  it('text typed while the save is pending survives a successful save', async () => {
    const user = userEvent.setup()
    const save = holdSave(b.memos.create)
    await renderScreen()
    fireEvent.change(input(), { target: { value: '첫 글' } })
    ctrlEnter(input())

    await user.type(input(), ' 더 쓴 내용')
    save.release()

    expect(await screen.findByText('첫 글')).toBeTruthy()
    expect(input().value).toBe('첫 글 더 쓴 내용')
  })

  it('keeps the input when saving fails', async () => {
    const save = holdSave(b.memos.create, internalError)
    await renderScreen()
    fireEvent.change(input(), { target: { value: '지키고 싶은 글' } })
    ctrlEnter(input())

    save.release()

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(input().value).toBe('지키고 싶은 글')
  })

  it('Ctrl+Enter spam during a slow edit save calls update once', async () => {
    const memo = b.memoRepo.create('기존 글')
    const save = holdSave(b.memos.update)
    await renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: `${t.edit}: 기존 글` }))
    const editBox = screen.getByLabelText(t.editLabel)
    fireEvent.change(editBox, { target: { value: '기존 글 고침' } })

    ctrlEnter(editBox)
    ctrlEnter(editBox)
    fireEvent.click(within(screen.getByRole('listitem')).getByRole('button', { name: t.save }))
    expect(b.memos.update).toHaveBeenCalledTimes(1)
    expect(b.memos.update).toHaveBeenCalledWith(memo.id, '기존 글 고침')

    save.release()
    await waitFor(() => expect(screen.queryByLabelText(t.editLabel)).toBeNull())
    expect(b.memos.update).toHaveBeenCalledTimes(1)
  })
})

describe('save guard: memo quick dialog', () => {
  let b: Backend

  beforeEach(() => {
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
  })

  const box = (): HTMLTextAreaElement => screen.getByLabelText(dialog.memoLabel) as HTMLTextAreaElement
  const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: dialog.save }) as HTMLButtonElement
  const ctrlEnter = (el: HTMLElement): void => {
    fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
  }

  it('Ctrl+Enter and button spam during a slow save call create once, then the dialog closes', async () => {
    const onSaved = vi.fn()
    const save = holdSave(b.memos.create)
    render(<MemoQuickDialog onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(box(), { target: { value: '대화상자 메모' } })

    ctrlEnter(box())
    ctrlEnter(box())
    fireEvent.click(saveButton())
    expect(saveButton().disabled).toBe(true)
    expect(b.memos.create).toHaveBeenCalledTimes(1)

    save.release()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(b.memos.create).toHaveBeenCalledTimes(1)
  })

  it('reports the success and keeps the full text in the box when more was typed', async () => {
    const onSaved = vi.fn()
    const save = holdSave(b.memos.create)
    render(<MemoQuickDialog onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(box(), { target: { value: '메모 한 줄' } })
    ctrlEnter(box())

    fireEvent.change(box(), { target: { value: '메모 한 줄 더' } })
    save.release()

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('메모 한 줄 더'))
    expect(box().value).toBe('메모 한 줄 더')
    expect(b.memos.create).toHaveBeenCalledTimes(1)
  })

  it('shows the error and keeps the text when saving fails', async () => {
    const onSaved = vi.fn()
    const save = holdSave(b.memos.create, internalError)
    render(<MemoQuickDialog onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(box(), { target: { value: '지키고 싶은 메모' } })
    ctrlEnter(box())

    save.release()

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(onSaved).not.toHaveBeenCalled()
    expect(box().value).toBe('지키고 싶은 메모')
  })
})

describe('save guard: refresh failures, transport exceptions, closed dialogs', () => {
  let b: Backend

  beforeEach(() => {
    b = installBackend()
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
  })

  const input = (): HTMLTextAreaElement => screen.getByLabelText(t.newLabel) as HTMLTextAreaElement
  const ctrlEnter = (el: HTMLElement): void => {
    fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true })
  }

  it('a list refresh that throws after a successful save keeps the typed text and does not lose it', async () => {
    render(<MemosScreen searchDebounceMs={0} />)
    await screen.findByLabelText(t.newLabel)
    const save = holdSave(b.memos.create)
    fireEvent.change(input(), { target: { value: '이미 저장' } })
    ctrlEnter(input())
    fireEvent.change(input(), { target: { value: '이미 저장 뒤 새 글' } })
    b.memos.list.mockRejectedValueOnce(new Error('refresh failed'))

    save.release()

    await waitFor(() => expect(b.memoRepo.list().map((m) => m.body)).toEqual(['이미 저장']))
    expect(input().value).toBe('이미 저장 뒤 새 글')
  })

  it('a rejected create on the memos screen shows an error, keeps the draft and allows retry', async () => {
    render(<MemosScreen searchDebounceMs={0} />)
    await screen.findByLabelText(t.newLabel)
    b.memos.create.mockRejectedValueOnce(new Error('transport down'))
    fireEvent.change(input(), { target: { value: '예외 뒤에도 남을 글' } })

    ctrlEnter(input())

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(input().value).toBe('예외 뒤에도 남을 글')
    ctrlEnter(input())
    await waitFor(() => expect(b.memoRepo.list()).toHaveLength(1))
  })

  it('a rejected create on the home card shows an error and keeps the draft', async () => {
    render(<MemoCard />)
    const box = (await screen.findByLabelText(card.quickLabel)) as HTMLInputElement
    b.memos.create.mockRejectedValueOnce(new Error('transport down'))
    fireEvent.change(box, { target: { value: '카드 예외 글' } })

    fireEvent.keyDown(box, { key: 'Enter' })

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(box.value).toBe('카드 예외 글')
  })

  it('a rejected create in the dialog shows an error and keeps the draft', async () => {
    const onSaved = vi.fn()
    render(<MemoQuickDialog onClose={vi.fn()} onSaved={onSaved} />)
    const box = screen.getByLabelText(dialog.memoLabel) as HTMLTextAreaElement
    b.memos.create.mockRejectedValueOnce(new Error('transport down'))
    fireEvent.change(box, { target: { value: '대화상자 예외 글' } })

    ctrlEnter(box)

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    expect(onSaved).not.toHaveBeenCalled()
    expect(box.value).toBe('대화상자 예외 글')
  })

  it('a save that finishes after the dialog closed does not call onSaved for a new dialog', async () => {
    const onSaved = vi.fn()
    const save = holdSave(b.memos.create)
    const first = render(<MemoQuickDialog onClose={vi.fn()} onSaved={onSaved} />)
    const box = screen.getByLabelText(dialog.memoLabel) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '닫힌 뒤 끝난 글' } })
    ctrlEnter(box)
    first.unmount()

    save.release()

    await waitFor(() => expect(b.memoRepo.list()).toHaveLength(1))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('a successful retry with leftovers clears the earlier failure message', async () => {
    const onSaved = vi.fn()
    render(<MemoQuickDialog onClose={vi.fn()} onSaved={onSaved} />)
    const box = screen.getByLabelText(dialog.memoLabel) as HTMLTextAreaElement
    b.memos.create.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    fireEvent.change(box, { target: { value: '재시도할 메모' } })
    ctrlEnter(box)
    await screen.findByRole('alert')

    const save = holdSave(b.memos.create)
    ctrlEnter(box)
    fireEvent.change(box, { target: { value: '재시도할 메모 남는 글' } })
    save.release()

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('재시도할 메모 남는 글'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

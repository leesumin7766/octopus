// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
import { createElement, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBackend } from '../renderer/backend'
import type { IpcResult } from '../../src/shared/ipc'
import type { Memo } from '../../src/shared/memos/types'
import { leftoverAfterSave } from '../../src/renderer/memos/leftoverAfterSave'

// The node typecheck includes verify without JSX support. Runtime imports keep
// these real UI components testable without changing either project config.
let MemoCard: ComponentType
let MemosScreen: ComponentType
let MemoQuickDialog: ComponentType<{ onClose: () => void; onSaved: (remaining: string) => void }>
let HomeScreen: ComponentType<{ arranging: boolean; onDoneArranging: () => void; onNavigate: () => void }>
beforeAll(async () => {
  const card = '../../src/renderer/home/cards/MemoCard'
  const memos = '../../src/renderer/memos/MemosScreen'
  const dialogs = '../../src/renderer/home/QuickDialogs'
  const home = '../../src/renderer/home/HomeScreen'
  MemoCard = (await import(card)).MemoCard
  MemosScreen = (await import(memos)).MemosScreen
  MemoQuickDialog = (await import(dialogs)).MemoQuickDialog
  HomeScreen = (await import(home)).HomeScreen
})
let backend: ReturnType<typeof installBackend>
const failure = { ok: false, error: { code: 'db_unavailable' } } as const
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  backend = installBackend()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('P5 forbids external requests') }))
})
afterEach(() => {
  cleanup()
  backend.t.db.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const surfaces = ['card', 'screen', 'dialog'] as const
// P5 round 2: changed drafts are preserved in full, including whitespace.
// The former prefix-removal expectation is not part of the accepted policy.
type Surface = typeof surfaces[number]
function change(input: HTMLElement, value: string) { fireEvent.change(input, { target: { value } }) }
function save(input: HTMLElement, surface: Surface = 'screen') {
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: surface !== 'card' })
}
async function mount(surface: Surface) {
  const onSaved = vi.fn()
  render(surface === 'card' ? createElement(MemoCard) : surface === 'screen' ? createElement(MemosScreen)
    : createElement(MemoQuickDialog, { onClose: vi.fn(), onSaved }))
  if (surface !== 'dialog') await waitFor(() => expect(backend.memos.list).toHaveBeenCalled())
  const input = screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', {
    name: surface === 'card' ? '빠른 메모' : surface === 'screen' ? '새 메모' : '메모 내용'
  })
  return { input, onSaved }
}
function holdCreate() {
  const pending = deferred<IpcResult<Memo>>()
  backend.memos.create.mockImplementationOnce(() => pending.promise)
  return pending
}
async function finish(pending: ReturnType<typeof holdCreate>, body: string) {
  await act(async () => pending.resolve({ ok: true, data: backend.memoRepo.create(body) }))
}

describe.each(surfaces)('P5 %s new memo', (surface) => {
  it('synchronous IPC exception preserves input and a successful retry clears the error', async () => {
    const { input } = await mount(surface)
    backend.memos.create.mockImplementationOnce(() => { throw new Error('P5 synchronous IPC failure') })
    change(input, '  예외에도 보존할 글  ')
    save(input, surface)
    await screen.findByRole('alert')
    expect(input.value).toBe('  예외에도 보존할 글  ')
    save(input, surface)
    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(backend.memos.create).toHaveBeenCalledTimes(2)
    expect(backend.memos.create).toHaveBeenLastCalledWith('  예외에도 보존할 글  ')
    expect(backend.memoRepo.list()).toHaveLength(1)
  })

  it('slow save: repeated keyboard and button actions create exactly one memo', async () => {
    const { input } = await mount(surface)
    const pending = holdCreate()
    change(input, '첫 기록')
    act(() => { for (let i = 0; i < 8; i++) save(input, surface) })
    if (surface !== 'card') {
      const button = screen.getByRole<HTMLButtonElement>('button', { name: '저장' })
      expect(button.disabled).toBe(true)
      for (let i = 0; i < 8; i++) fireEvent.click(button)
    }
    expect(backend.memos.create).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('첫 기록')
    await finish(pending, '첫 기록')
    await waitFor(() => expect(input.value).toBe(''))
    expect(backend.memoRepo.list().map(m => m.body)).toEqual(['첫 기록'])
  })

  it.each([
    ['unchanged', '보낸 글', ''],
    ['appended', '보낸 글   다음 글', '보낸 글   다음 글'],
    ['whitespace only', '보낸 글   ', '보낸 글   '],
    ['edited prefix', '수정한 글 뒤 추가', '수정한 글 뒤 추가']
  ])('success preserves whole draft: %s; next save sends the retained text', async (_name, current, expected) => {
    const { input, onSaved } = await mount(surface)
    const pending = holdCreate()
    change(input, '보낸 글')
    save(input, surface)
    change(input, current)
    await finish(pending, '보낸 글')
    await waitFor(() => expect(input.value).toBe(expected))
    if (surface === 'dialog') expect(onSaved).toHaveBeenCalledWith(expected)
    save(input, surface)
    await waitFor(() => expect(backend.memoRepo.list()).toHaveLength(expected ? 2 : 1))
    // The confirmed policy permits saving the original prefix again.
    if (expected) expect(backend.memos.create).toHaveBeenLastCalledWith(expected)
  })

  it.each(['db_unavailable', 'invalid_input'] as const)('%s response preserves latest input and permits retry', async (code) => {
    const { input, onSaved } = await mount(surface)
    const pending = holdCreate()
    change(input, '실패할 요청')
    save(input, surface)
    change(input, '실패할 요청 뒤 새 글')
    await act(async () => pending.resolve({ ok: false, error: { code } }))
    expect(input.value).toBe('실패할 요청 뒤 새 글')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
    save(input, surface)
    await waitFor(() => expect(input.value).toBe(''))
    expect(backend.memoRepo.list().map(m => m.body)).toEqual(['실패할 요청 뒤 새 글'])
  })

  it('transport exception preserves draft, unlocks retry, and reports failure', async () => {
    const { input } = await mount(surface)
    const pending = holdCreate()
    change(input, '예외 전 글')
    save(input, surface)
    change(input, '예외 후에도 남을 글')
    // Intentionally do not suppress unhandled rejections: they are product failures.
    await act(async () => pending.reject(new Error(`P5 ${surface} transport failure`)))
    expect(input.value).toBe('예외 후에도 남을 글')
    const reported = screen.queryByRole('alert')
    save(input, surface)
    await waitFor(() => expect(input.value).toBe(''))
    expect(backend.memoRepo.list()).toHaveLength(1)
    expect(reported, 'exception must be visible, not an unhandled rejection').not.toBeNull()
  })

  it('composition Enter and plain multiline Enter do not save', async () => {
    const { input } = await mount(surface)
    change(input, '한글')
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    if (surface !== 'card') fireEvent.keyDown(input, { key: 'Enter' })
    expect(backend.memos.create).not.toHaveBeenCalled()
  })
})

it.each(['screen', 'dialog'] as const)('%s button-first slow save blocks mixed repeated actions after draft changes', async (surface) => {
  const { input } = await mount(surface)
  const pending = holdCreate()
  change(input, '버튼으로 보낸 글')
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '저장' })
  fireEvent.click(button)
  change(input, '버튼으로 보낸 글  이어 쓰기  ')
  expect(button.disabled).toBe(true)
  act(() => {
    for (let i = 0; i < 8; i++) {
      fireEvent.click(button)
      save(input, surface)
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    }
  })
  expect(backend.memos.create.mock.calls).toEqual([['버튼으로 보낸 글']])
  await finish(pending, '버튼으로 보낸 글')
  await waitFor(() => expect(button.disabled).toBe(false))
  expect(input.value).toBe('버튼으로 보낸 글  이어 쓰기  ')
  expect(backend.memoRepo.list()).toHaveLength(1)
})

it.each([
  ['동일', '동일', ''],
  ['원문\n \t새 줄  \n', '원문', '원문\n \t새 줄  \n'],
  ['원문\n \t', '원문', '원문\n \t'],
  ['원문을 고침', '원문 전체', '원문을 고침'],
  ['', '지운 글', '']
])('leftover policy current=%j sent=%j', (current, sent, expected) => {
  expect(leftoverAfterSave(current, sent)).toBe(expected)
})

async function editFirst() {
  const memo = backend.memoRepo.create('기존 메모')
  await mount('screen')
  fireEvent.click(await screen.findByRole('button', { name: '수정: 기존 메모' }))
  return { memo, input: screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 수정' }) }
}
it('edit slow save keeps newer edits; retry updates the same id and then closes', async () => {
  const { memo, input } = await editFirst()
  const pending = deferred<IpcResult<Memo>>()
  backend.memos.update.mockImplementationOnce(() => pending.promise)
  change(input, '수정 1')
  act(() => { save(input); save(input) })
  change(input, '수정 2')
  expect(backend.memos.update).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve({ ok: true, data: backend.memoRepo.update(memo.id, '수정 1') }))
  expect(input.value).toBe('수정 2')
  save(input)
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '메모 수정' })).toBeNull())
  expect(backend.memos.update.mock.calls).toEqual([[memo.id, '수정 1'], [memo.id, '수정 2']])
  expect(backend.memoRepo.list().map(m => m.body)).toEqual(['수정 2'])
})
it('edit failure preserves newer text and cancel prevents late response reopening editor', async () => {
  const { input } = await editFirst()
  const pending = deferred<IpcResult<Memo>>()
  backend.memos.update.mockImplementationOnce(() => pending.promise)
  change(input, '보낼 수정')
  save(input)
  change(input, '보존할 수정')
  await act(async () => pending.resolve(failure))
  expect(input.value).toBe('보존할 수정')
  const late = deferred<IpcResult<Memo>>()
  backend.memos.update.mockImplementationOnce(() => late.promise)
  save(input)
  fireEvent.keyDown(input, { key: 'Escape' })
  await act(async () => late.resolve({ ok: false, error: { code: 'invalid_input' } }))
  expect(screen.queryByRole('textbox', { name: '메모 수정' })).toBeNull()
})
it.each(['card', 'screen'] as const)('%s ignores stale list response after saved memo refresh', async (surface) => {
  await mount(surface)
  const old = deferred<IpcResult<Memo[]>>()
  backend.memos.list.mockImplementationOnce(() => old.promise)
  fireEvent.focus(window)
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: surface === 'card' ? '빠른 메모' : '새 메모' })
  change(input, '새 목록에 남을 메모')
  save(input, surface)
  await screen.findByText('새 목록에 남을 메모', { selector: surface === 'card' ? 'span' : 'p' })
  await act(async () => old.resolve({ ok: true, data: [] }))
  expect(screen.getByText('새 목록에 남을 메모', { selector: surface === 'card' ? 'span' : 'p' })).toBeTruthy()
})

async function home() {
  render(createElement(HomeScreen, { arranging: false, onDoneArranging: vi.fn(), onNavigate: vi.fn() }))
  await waitFor(() => expect(backend.memos.list).toHaveBeenCalled())
  await openMemo()
}
async function openMemo() {
  fireEvent.click(screen.getByRole('button', { name: 'Octopus 메뉴' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '메모 쓰기' }))
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' })
}
it.each([false, true])('home success refreshes list and notifies; appended=%s controls closing', async (appended) => {
  await home()
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' })
  const pending = holdCreate()
  change(input, '원형 저장')
  save(input)
  if (appended) change(input, '원형 저장\n 다음 메모')
  await finish(pending, '원형 저장')
  await screen.findByText('메모를 저장했어요.')
  await screen.findByText('원형 저장', { selector: 'span' })
  if (appended) expect(input.value).toBe('원형 저장\n 다음 메모')
  else expect(screen.queryByRole('dialog')).toBeNull()
})
it('canceled dialog late success cannot close a newly opened draft', async () => {
  await home()
  const oldInput = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' })
  const pending = holdCreate()
  change(oldInput, '이전 요청')
  save(oldInput)
  fireEvent.keyDown(oldInput, { key: 'Escape' })
  const fresh = await openMemo()
  change(fresh, '새 대화상자 초안')
  await finish(pending, '이전 요청')
  expect(screen.queryByRole('textbox', { name: '메모 내용' }), 'old completion must not close new dialog').not.toBeNull()
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' }).value).toBe('새 대화상자 초안')
})
it.each(['success', 'failure'] as const)('canceled dialog %s arriving after the new dialog success cannot overwrite its draft or error', async (outcome) => {
  await home()
  const oldInput = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' })
  const old = holdCreate()
  change(oldInput, '취소한 창의 요청')
  save(oldInput)
  fireEvent.keyDown(oldInput, { key: 'Escape' })
  const fresh = await openMemo()
  const recent = holdCreate()
  change(fresh, '새 창의 요청')
  save(fresh)
  change(fresh, '새 창의 요청\n  보존할 초안  ')
  await finish(recent, '새 창의 요청')
  await screen.findByText('메모를 저장했어요.')
  if (outcome === 'success') await finish(old, '취소한 창의 요청')
  else await act(async () => old.resolve(failure))
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' }).value).toBe('새 창의 요청\n  보존할 초안  ')
  expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull()
  expect(backend.memos.create).toHaveBeenCalledTimes(2)
})
it('dialog retry success with leftovers clears obsolete failure', async () => {
  await home()
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '메모 내용' })
  backend.memos.create.mockResolvedValueOnce(failure)
  change(input, '재시도할 메모')
  save(input)
  await screen.findByRole('alert')
  const pending = holdCreate()
  save(input)
  change(input, '재시도할 메모\n 남는 글')
  await finish(pending, '재시도할 메모')
  expect(input.value).toBe('재시도할 메모\n 남는 글')
  expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull()
})
it.each(['card', 'screen'] as const)('%s successful create clears unchanged input even if refresh throws', async (surface) => {
  const { input } = await mount(surface)
  const pending = holdCreate()
  change(input, '이미 저장된 부분')
  save(input, surface)
  backend.memos.list.mockRejectedValueOnce(new Error('P5 post-save refresh failure'))
  await finish(pending, '이미 저장된 부분')
  expect(input.value).toBe('')
  expect(screen.getByRole('alert')).toBeTruthy()
  save(input, surface)
  expect(backend.memos.create).toHaveBeenCalledTimes(1)
  expect(backend.memoRepo.list().map(m => m.body)).toEqual(['이미 저장된 부분'])
})
it.each(['card', 'screen'] as const)('%s successful create preserves entire changed input even if refresh throws', async (surface) => {
  const { input } = await mount(surface)
  const pending = holdCreate()
  change(input, '이미 저장된 부분')
  save(input, surface)
  change(input, '이미 저장된 부분 뒤 새 글')
  backend.memos.list.mockRejectedValueOnce(new Error('P5 post-save refresh failure'))
  await finish(pending, '이미 저장된 부분')
  const remaining = input.value
  save(input, surface)
  await waitFor(() => expect(backend.memoRepo.list()).toHaveLength(2))
  expect(remaining).toBe('이미 저장된 부분 뒤 새 글')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(backend.memoRepo.list().map(m => m.body).sort()).toEqual(['이미 저장된 부분 뒤 새 글', '이미 저장된 부분'].sort())
})

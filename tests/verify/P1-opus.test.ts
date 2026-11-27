// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// P1 독립 검증(Opus): 쓰던 내용 보호. 데이터 변경에도 입력 유지, 다른 항목·화면으로 갈 때 먼저 확인.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

let App: ComponentType
let notifyDataChanged: () => void
beforeAll(async () => {
  const a = '../../src/renderer/App'
  const d = '../../src/renderer/dataEvents'
  App = (await import(a)).App
  notifyDataChanged = (await import(d)).notifyDataChanged
})

const n = ko.nav
const h = ko.home.localCalendar
const d = ko.tasks.detail
const TODAY = '2026-03-10'
let b: Backend

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  b = installBackend()
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

const menu = (): HTMLElement => screen.getByRole('navigation', { name: n.label })
const go = async (user: ReturnType<typeof userEvent.setup>, label: string) => user.click(within(menu()).getByRole('button', { name: label }))
const strip = (): HTMLElement | null => screen.queryByRole('group', { name: h.discardTitle }) ?? screen.queryByRole('group', { name: h.editDiscardTitle })
const panel = (): HTMLElement => screen.getByRole('complementary', { name: d.title })
const titleField = (): HTMLInputElement => within(panel()).getByLabelText(d.titleField) as HTMLInputElement

async function start() {
  const user = userEvent.setup()
  render(createElement(App))
  await screen.findByRole('navigation', { name: n.label })
  return user
}

describe('P1 (Opus) task detail', () => {
  it('editing one task then clicking another asks; keep stays with the edit, discard opens the other', async () => {
    b.t.repo.create({ title: '첫째 일', date: TODAY })
    b.t.repo.create({ title: '둘째 일', date: TODAY })
    const user = await start()
    await go(user, n.tasks)
    await user.click(await screen.findByText('첫째 일'))
    await screen.findByRole('complementary', { name: d.title })
    await user.type(titleField(), ' 고침')

    await user.click(screen.getAllByText('둘째 일')[0])
    expect(strip()).toBeTruthy()
    await user.click(within(strip()!).getByRole('button', { name: h.discardNo }))
    expect(strip()).toBeNull()
    expect(titleField().value).toBe('첫째 일 고침')

    await user.click(screen.getAllByText('둘째 일')[0])
    await user.click(within(strip()!).getByRole('button', { name: h.discardYes }))
    await waitFor(() => expect(titleField().value).toBe('둘째 일'))
    expect(b.tasks.update).not.toHaveBeenCalled()
  })

  it('closing the panel with an edit asks first', async () => {
    b.t.repo.create({ title: '닫을 일', date: TODAY })
    const user = await start()
    await go(user, n.tasks)
    await user.click(await screen.findByText('닫을 일'))
    await screen.findByRole('complementary', { name: d.title })
    await user.type(titleField(), '!')
    await user.click(within(panel()).getByRole('button', { name: d.close }))
    expect(strip()).toBeTruthy()
    await user.click(within(strip()!).getByRole('button', { name: h.discardNo }))
    expect(titleField().value).toBe('닫을 일!')
  })

  it('a data change during an edit keeps the edit and the quick-input text, and still shows the new task', async () => {
    b.t.repo.create({ title: '편집 중인 일', date: TODAY })
    const user = await start()
    await go(user, n.tasks)
    await user.type(await screen.findByLabelText(ko.tasks.quickInputLabel), '빠른 입력 글')
    await user.click(await screen.findByText('편집 중인 일'))
    await screen.findByRole('complementary', { name: d.title })
    await user.type(titleField(), ' 수정')

    b.t.repo.create({ title: '바깥에서 생긴 일', date: TODAY })
    act(() => notifyDataChanged())
    expect(await screen.findByText('바깥에서 생긴 일')).toBeTruthy()
    expect(titleField().value).toBe('편집 중인 일 수정')
    expect((screen.getByLabelText(ko.tasks.quickInputLabel) as HTMLInputElement).value).toBe('빠른 입력 글')
  })
})

describe('P1 (Opus) screens', () => {
  it('after discarding and leaving, coming back with nothing written moves without asking (no stale registration)', async () => {
    const user = await start()
    await go(user, n.memos)
    await user.type(await screen.findByLabelText(ko.memos.newLabel), '버릴 글')
    await go(user, n.tasks)
    await user.click(within(strip()!).getByRole('button', { name: h.discardYes }))
    await screen.findByLabelText(ko.tasks.quickInputLabel)
    await go(user, n.memos)
    expect(strip()).toBeNull()
    expect(((await screen.findByLabelText(ko.memos.newLabel)) as HTMLTextAreaElement).value).toBe('')
    await go(user, n.home)
    expect(strip()).toBeNull()
  })

  it('clearing the quick input removes the question', async () => {
    const user = await start()
    await go(user, n.tasks)
    const box = (await screen.findByLabelText(ko.tasks.quickInputLabel)) as HTMLInputElement
    await user.type(box, '잠깐')
    await user.clear(box)
    await go(user, n.memos)
    expect(strip()).toBeNull()
    expect(await screen.findByLabelText(ko.memos.newLabel)).toBeTruthy()
  })

  it('editing a memo then starting to edit another memo asks first', async () => {
    b.memoRepo.create('메모 하나')
    b.memoRepo.create('메모 둘')
    const user = await start()
    await go(user, n.memos)
    await screen.findByText('메모 하나')
    await user.click(screen.getByRole('button', { name: `${ko.memos.edit}: 메모 하나` }))
    const editor = (await screen.findByLabelText(ko.memos.editLabel)) as HTMLTextAreaElement
    await user.type(editor, ' 더')
    const before = editor.value
    await user.click(screen.getByRole('button', { name: `${ko.memos.edit}: 메모 둘` }))
    expect(strip()).toBeTruthy()
    await user.click(within(strip()!).getByRole('button', { name: h.discardNo }))
    expect((screen.getByLabelText(ko.memos.editLabel) as HTMLTextAreaElement).value).toBe(before)
    await user.click(screen.getByRole('button', { name: `${ko.memos.edit}: 메모 둘` }))
    await user.click(within(strip()!).getByRole('button', { name: h.discardYes }))
    expect((screen.getByLabelText(ko.memos.editLabel) as HTMLTextAreaElement).value).toBe('메모 둘')
    expect(b.memos.update).not.toHaveBeenCalled()
  })

  it('a draft in the calendar tab day panel asks before the left menu moves', async () => {
    const user = await start()
    await go(user, n.calendar)
    const day = await screen.findByRole('region', { name: /2026년 3월 10일/ })
    await user.type(within(day).getByLabelText(h.addLabel), '달력 초안')
    await go(user, n.memos)
    expect(strip()).toBeTruthy()
    expect(screen.queryByLabelText(ko.memos.newLabel)).toBeNull()
    await user.click(within(strip()!).getByRole('button', { name: h.discardNo }))
    expect((within(day).getByLabelText(h.addLabel) as HTMLInputElement).value).toBe('달력 초안')
  })

  it('routines screen re-reads on a data change without remounting', async () => {
    const user = await start()
    await go(user, n.routines)
    await screen.findByRole('heading', { level: 1 })
    const before = b.routines.list.mock.calls.length
    act(() => notifyDataChanged())
    await waitFor(() => expect(b.routines.list.mock.calls.length).toBeGreaterThan(before))
  })
})

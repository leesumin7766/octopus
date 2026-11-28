// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { ActionNotice, NOTICE_MS } from '../../src/renderer/ui/ActionNotice'
import { installBackend, type Backend } from './backend'

// F3: 추가한 할 일이 지금 보는 곳에 안 보이면 알려 주고, [보기] 로 그 보기에서 연다.
// 2026-11-25(수) 정오. 제목에 '일'·'월' 같은 한 글자 낱말을 혼자 쓰면 요일로 읽힌다.
const t = ko.tasks

describe('added-task notice and [보기]', () => {
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

  const homeCard = (): Promise<HTMLElement> => screen.findByRole('region', { name: ko.home.cards.todo })
  const detail = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: t.detail.title })
  const titleOf = (panel: HTMLElement): string => (within(panel).getByLabelText(t.detail.titleField) as HTMLInputElement).value
  const heading = (name: string): HTMLElement => screen.getByRole('heading', { level: 1, name })

  it('home: "보고서" goes to the inbox → notice → [보기] opens the inbox with it selected', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '보고서{Enter}')

    expect(await within(card).findByText(t.added.inbox)).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: t.added.view }))

    expect(await detail().then(titleOf)).toBe('보고서')
    expect(heading(t.views.inbox)).toBeTruthy()
  })

  it('home: "내일 보고서" → 예정 view with it selected', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '내일 보고서{Enter}')

    expect(await within(card).findByText(t.added.on('내일'))).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: t.added.view }))

    expect(await detail().then(titleOf)).toBe('보고서')
    expect(heading(t.views.upcoming)).toBeTruthy()
  })

  it('home: "오늘 보고서" and "3시 보고서" show in the card with no notice', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '오늘 보고서{Enter}')
    expect(await within(card).findByText('보고서')).toBeTruthy()
    await user.type(within(card).getByLabelText(t.quickInputLabel), '3시 점검{Enter}')
    expect(await within(card).findByText('점검')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: t.added.view })).toBeNull()
  })

  it('home: writing something else in the input then pressing [보기] asks first', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const card = await homeCard()
    const input = within(card).getByLabelText(t.quickInputLabel) as HTMLInputElement
    await user.type(input, '보고서{Enter}')
    await within(card).findByText(t.added.inbox)
    await user.type(input, '쓰던 글')

    await user.click(within(card).getByRole('button', { name: t.added.view }))
    expect(screen.getByText(ko.home.localCalendar.discardTitle)).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: t.detail.title })).toBeNull()

    await user.click(screen.getByRole('button', { name: ko.home.localCalendar.discardYes }))
    expect(await detail().then(titleOf)).toBe('보고서')
  })

  it('tasks tab 오늘: "다음주 월 회의" → notice → [보기] switches to 예정 and selects it', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    render(<App />)
    const input = await screen.findByLabelText(t.quickInputLabel)
    await user.type(input, '다음주 월 회의{Enter}')

    expect(await screen.findByText(t.added.on('11/30 (월)'))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: t.added.view }))

    expect(await detail().then(titleOf)).toBe('회의')
    expect(heading(t.views.upcoming)).toBeTruthy()
  })

  it('tasks tab: adding to the view you are in gives no notice', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    render(<App />)
    await user.type(await screen.findByLabelText(t.quickInputLabel), '오늘 점검{Enter}')
    expect(await screen.findByText('점검')).toBeTruthy()
    expect(screen.queryByRole('button', { name: t.added.view })).toBeNull()
  })
})

describe('ActionNotice', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('is a status, runs its action, and expires after the notice time', () => {
    vi.useFakeTimers()
    const onAction = vi.fn()
    const onExpire = vi.fn()
    render(<ActionNotice message="알림" actionLabel="보기" onAction={onAction} onExpire={onExpire} />)

    expect(screen.getByRole('status').textContent).toContain('알림')
    act(() => void screen.getByRole('button', { name: '보기' }).click())
    expect(onAction).toHaveBeenCalledTimes(1)

    act(() => void vi.advanceTimersByTime(NOTICE_MS - 1))
    expect(onExpire).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})

// F4: 홈에서 눌러서 이어 가기
describe('continuing from the home screen (F4)', () => {
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

  const detail = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: t.detail.title })
  const titleOf = (panel: HTMLElement): string => (within(panel).getByLabelText(t.detail.titleField) as HTMLInputElement).value

  it('clicking a home 오늘 할 일 title opens its detail panel (a routine item too); the checkbox still checks', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.t.repo.create({ title: '보고서', date: '2026-11-25' })
    b.routineRepo.create({ title: '아침 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, '2026-11-25')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(await within(card).findByRole('button', { name: '보고서' }))
    expect(await detail().then(titleOf)).toBe('보고서')
    expect(screen.getByRole('heading', { level: 1, name: t.views.today })).toBeTruthy()
  })

  it('a routine item opens the same way', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.routineRepo.create({ title: '아침 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, '2026-11-25')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(await within(card).findByRole('button', { name: '아침 스트레칭' }))
    expect(await detail().then(titleOf)).toBe('아침 스트레칭')
  })

  it('pressing the title with the keyboard (Enter) opens it too', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.t.repo.create({ title: '보고서', date: '2026-11-25' })
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    const button = await within(card).findByRole('button', { name: '보고서' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(await detail().then(titleOf)).toBe('보고서')
  })

  it('clicking a home memo opens the memo screen with that memo in edit mode', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.memoRepo.create('첫 메모')
    const target = b.memoRepo.create('찾을 메모\n둘째 줄')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.memo })
    await user.click(await within(card).findByRole('button', { name: '찾을 메모' }))

    const editor = (await screen.findByLabelText(ko.memos.editLabel)) as HTMLTextAreaElement
    expect(editor.value).toBe('찾을 메모\n둘째 줄')
    expect(document.querySelector(`[data-memo-id="${target.id}"]`)?.className).toContain('ring-2')
  })

  it('home memo click asks first when the home input has unsaved text', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.memoRepo.create('찾을 메모')
    b.t.repo.create({ title: '보고서', date: '2026-11-25' })
    render(<App />)
    const todo = await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.type(within(todo).getByLabelText(t.quickInputLabel), '쓰던 글')
    const card = screen.getByRole('region', { name: ko.home.cards.memo })
    await user.click(await within(card).findByRole('button', { name: '찾을 메모' }))

    expect(screen.getByText(ko.home.localCalendar.discardTitle)).toBeTruthy()
    expect(screen.queryByLabelText(ko.memos.editLabel)).toBeNull()
    await user.click(screen.getByRole('button', { name: ko.home.localCalendar.discardYes }))
    expect(await screen.findByLabelText(ko.memos.editLabel)).toBeTruthy()
  })

  it('home task title click asks first when something is unsaved', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.t.repo.create({ title: '보고서', date: '2026-11-25' })
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.type(within(card).getByLabelText(t.quickInputLabel), '쓰던 글')
    await user.click(await within(card).findByRole('button', { name: '보고서' }))
    expect(screen.getByText(ko.home.localCalendar.discardTitle)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: ko.home.localCalendar.discardYes }))
    expect(await detail().then(titleOf)).toBe('보고서')
  })

  it('memo → 할 일로 만들기 → [보기] opens that task; asks first if a memo is being edited', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    b.memoRepo.create('치과 예약')
    b.memoRepo.create('쓰는 중 메모')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: ko.nav.memos }))
    const list = await screen.findByRole('region', { name: ko.memos.listLabel })
    const row = (await within(list).findByText('치과 예약')).closest('li') as HTMLElement
    await user.click(within(row).getByRole('button', { name: ko.memos.toTask }))
    expect(await screen.findByText(ko.memos.madeTask)).toBeTruthy()

    // 다른 메모를 고치는 중이면 먼저 묻는다
    await user.click(within(list).getByRole('button', { name: new RegExp('^' + ko.memos.edit + ': 쓰는 중 메모') }))
    await user.type(await screen.findByLabelText(ko.memos.editLabel), ' 추가')
    await user.click(screen.getByRole('button', { name: ko.memos.madeTaskView }))
    expect(screen.getByText(ko.home.localCalendar.discardTitle)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: ko.home.localCalendar.discardYes }))

    expect(await detail().then(titleOf)).toBe('치과 예약')
  })

  it('the memo highlight still goes away after 3s when the list reloads in between', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    b = installBackend('home')
    const target = b.memoRepo.create('강조될 메모')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.memo })
    await user.click(await within(card).findByRole('button', { name: '강조될 메모' }))
    await screen.findByLabelText(ko.memos.editLabel)
    const row = (): Element | null => document.querySelector(`[data-memo-id="${target.id}"]`)
    expect(row()?.className).toContain('ring-2')

    const before = b.memos.list.mock.calls.length
    await act(async () => void fireEvent.focus(window)) // 창 포커스 → 목록 다시 읽기
    await waitFor(() => expect(b.memos.list.mock.calls.length).toBeGreaterThan(before))
    await act(async () => void vi.advanceTimersByTime(3500))
    expect(row()?.className ?? '').not.toContain('ring-2')
  })
})

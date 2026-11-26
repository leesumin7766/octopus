// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { notifyDataChanged } from '../../src/renderer/dataEvents'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// C2 검사(사용자 흐름 → 실제 IPC → 임시 DB). 기준일 T = 2026-11-24(화).
// 샘플: A 아침 T 09:00 / B 시간 없음 T / I 반복(매일) T / C 내일 T+1 14:00.

const m = ko.home.localCalendar
const T = '2026-11-24'
const T1 = '2026-11-25'
const T2 = '2026-11-26'
const cell = (date: string): HTMLElement => document.querySelector(`[data-date="${date}"]`) as HTMLElement
const dialogFor = (title: string): Promise<HTMLElement> => screen.findByRole('dialog', { name: title })
const countOf = (date: string): string => cell(date).getAttribute('aria-label') ?? ''

describe('C2 day actions', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 24, 12))
    b = installBackend('home')
    const repo = b.t.repo
    repo.create({ title: 'A 아침', date: T, time: '09:00' })
    repo.create({ title: 'B 시간없음', date: T })
    repo.create({ title: 'I 반복', date: T, repeat: { freq: 'daily', interval: 1 } })
    repo.create({ title: 'C 내일', date: T1, time: '14:00' })
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  async function home(): Promise<HTMLElement> {
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.calendar })
    await waitFor(() => expect(cell(T)).toBeTruthy())
    return card
  }

  async function openDay(date: string, title: string): Promise<{ dialog: HTMLElement; user: ReturnType<typeof userEvent.setup> }> {
    const user = userEvent.setup()
    await home()
    await user.click(cell(date))
    return { dialog: await dialogFor(title), user }
  }

  const rowsIn = (date: string): string[] => b.t.repo.listRange(date, date).map((x) => x.title)
  const titleField = (dialog: HTMLElement): HTMLInputElement => within(dialog).getByLabelText(m.addLabel) as HTMLInputElement
  const addButton = (dialog: HTMLElement): HTMLElement => within(dialog).getByRole('button', { name: m.addButton })

  describe('adding (C2-01, C2-02, C2-03)', () => {
    it('C2-01: adds one task on the selected day with that exact date; the title is not read for dates', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '내일 회의')
      fireEvent.change(within(dialog).getByLabelText(m.addTimeLabel), { target: { value: '10:30' } })
      await user.click(addButton(dialog))

      await waitFor(() => expect(rowsIn(T1)).toContain('내일 회의'))
      expect(rowsIn(T2)).not.toContain('내일 회의')
      const saved = b.t.repo.listRange(T1, T1).find((x) => x.title === '내일 회의')
      expect(saved?.date).toBe(T1)
      expect(saved?.time).toBe('10:30')
      expect(b.tasks.create).toHaveBeenCalledWith(expect.objectContaining({ title: '내일 회의', date: T1 }))
      // 따로 "추가했어요" 문구 없이, 입력칸이 비고 목록에 바로 나타난다
      expect(await within(dialog).findByText('내일 회의')).toBeTruthy()
      expect(titleField(dialog).value).toBe('')
      expect(within(dialog).queryByText(m.addSaved)).toBeNull()
    })

    it('C2-01: the month count and the day list agree with the saved task', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '추가 확인')
      await user.click(addButton(dialog))
      await waitFor(() => expect(countOf(T1)).toContain('할 일 2개'))
      expect(within(dialog).getByText('추가 확인')).toBeTruthy()
    })

    it('C2-02: pressing add twice (and Enter) while saving creates one task only', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      const real = b.tasks.create.getMockImplementation()!
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      b.tasks.create.mockImplementationOnce(async (input: unknown) => {
        await gate
        return real(input as never)
      })
      await user.type(titleField(dialog), '중복 검사')
      await user.click(addButton(dialog))
      await user.click(addButton(dialog))
      await user.type(titleField(dialog), '{Enter}')
      expect(b.tasks.create).toHaveBeenCalledTimes(1)

      await act(async () => release())
      await waitFor(() => expect(rowsIn(T1).filter((t) => t === '중복 검사')).toHaveLength(1))
    })

    it('C2-03: a failed save keeps the text, says so, and a retry saves it once', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      b.tasks.create.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      await user.type(titleField(dialog), '재시도 대상')
      await user.click(addButton(dialog))

      expect(await within(dialog).findByRole('alert')).toBeTruthy()
      expect(within(dialog).getByRole('alert').textContent).toBe(m.addFailed)
      expect(titleField(dialog).value).toBe('재시도 대상')
      expect(rowsIn(T1)).not.toContain('재시도 대상')
      expect(within(dialog).queryByText(m.addSaved)).toBeNull()

      await user.click(addButton(dialog))
      await waitFor(() => expect(rowsIn(T1).filter((t) => t === '재시도 대상')).toHaveLength(1))
    })

    it('an empty title cannot be saved', async () => {
      const { dialog } = await openDay(T1, '2026년 11월 25일 (수)')
      expect(addButton(dialog).hasAttribute('disabled')).toBe(true)
    })
  })

  describe('leaving with unsaved text (C2-04)', () => {
    it('Esc with text shows the discard question; 계속 쓰기 keeps the dialog and the text', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '버리면 안 되는 글')
      await user.keyboard('{Escape}')

      expect(within(dialog).getByText(m.discardTitle)).toBeTruthy()
      await user.click(within(dialog).getByRole('button', { name: m.discardNo }))
      expect(screen.getByRole('dialog', { name: '2026년 11월 25일 (수)' })).toBeTruthy()
      expect(titleField(dialog).value).toBe('버리면 안 되는 글')
    })

    it('버리기 closes the dialog and the text is gone', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '버릴 글')
      await user.keyboard('{Escape}')
      await user.click(within(dialog).getByRole('button', { name: m.discardYes }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(rowsIn(T1)).not.toContain('버릴 글')
    })

    it('moving to another day with text asks first and does not change the day', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '날짜 이동 전')
      await user.click(within(dialog).getByRole('button', { name: m.nextDay }))
      expect(within(dialog).getByText(m.discardTitle)).toBeTruthy()
      expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
      expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('2026년 11월 25일 (수)')
    })

    it('a backdrop click with text asks first', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '배경 클릭 전')
      fireEvent.mouseDown(dialog.parentElement as HTMLElement)
      expect(within(dialog).getByText(m.discardTitle)).toBeTruthy()
    })

    it('after a failed save, closing still asks first instead of closing silently', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      b.tasks.create.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      await user.type(titleField(dialog), '실패 뒤 닫기')
      await user.click(addButton(dialog))
      await within(dialog).findByRole('alert')
      await user.keyboard('{Escape}')
      expect(within(dialog).getByText(m.discardTitle)).toBeTruthy()
      expect(titleField(dialog).value).toBe('실패 뒤 닫기')
    })

    it('while a save is running the day cannot be moved', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      const real = b.tasks.create.getMockImplementation()!
      let release!: () => void
      b.tasks.create.mockImplementationOnce(async (input: unknown) => {
        await new Promise<void>((resolve) => (release = resolve))
        return real(input as never)
      })
      await user.type(titleField(dialog), '저장 중 이동')
      await user.click(addButton(dialog))
      expect(within(dialog).getByRole('button', { name: m.nextDay }).hasAttribute('disabled')).toBe(true)
      await act(async () => release())
      await waitFor(() => expect(rowsIn(T1)).toContain('저장 중 이동'))
      expect(cell(T1).getAttribute('aria-pressed')).toBe('true')
    })

    it('Tab stays inside the dialog while the add form and the discard question are showing', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.type(titleField(dialog), '포커스')
      await user.keyboard('{Escape}')
      for (let i = 0; i < 30; i++) {
        await user.tab()
        expect(dialog.contains(document.activeElement)).toBe(true)
      }
      for (let i = 0; i < 30; i++) {
        await user.tab({ shift: true })
        expect(dialog.contains(document.activeElement)).toBe(true)
      }
    })
  })

  describe('completing (C2-05, C2-08)', () => {
    it('C2-05: completing in the day detail stores done, and the month count and the item agree; undoing reverses it', async () => {
      const { dialog, user } = await openDay(T, '2026년 11월 24일 (화) · 오늘')
      const box = within(dialog).getByRole('checkbox', { name: m.toggleLabel('A 아침') }) as HTMLInputElement
      expect(box.checked).toBe(false)

      await user.click(box)
      await waitFor(() => expect(b.t.repo.listRange(T, T).find((x) => x.title === 'A 아침')?.status).toBe('done'))
      await waitFor(() => expect(countOf(T)).toContain('완료 1개'))
      expect((within(dialog).getByRole('checkbox', { name: m.toggleLabel('A 아침') }) as HTMLInputElement).checked).toBe(true)

      await user.click(within(dialog).getByRole('checkbox', { name: m.toggleLabel('A 아침') }))
      await waitFor(() => expect(b.t.repo.listRange(T, T).find((x) => x.title === 'A 아침')?.status).toBe('open'))
      await waitFor(() => expect(countOf(T)).not.toContain('완료'))
    })

    it('C2-06: the same change shows on the 오늘 할 일 card of the home screen', async () => {
      const user = userEvent.setup()
      const card = await home()
      const todo = screen.getByRole('region', { name: ko.home.cards.todo })
      expect(await within(todo).findByRole('checkbox', { name: new RegExp('A 아침') })).toBeTruthy()

      await user.click(cell(T))
      const dialog = await dialogFor('2026년 11월 24일 (화) · 오늘')
      await user.click(within(dialog).getByRole('checkbox', { name: m.toggleLabel('A 아침') }))
      await user.keyboard('{Escape}')
      expect(card).toBeTruthy()
      // 완료된 항목은 오늘 카드의 미완료 목록에서 사라진다(카드의 기존 동작).
      await waitFor(() => expect(within(todo).queryByRole('checkbox', { name: new RegExp('A 아침') })).toBeNull())
    })

    it('C2-08: repeated clicks while saving make one request; the repeating task gives one next occurrence; undo removes it', async () => {
      const { dialog, user } = await openDay(T, '2026년 11월 24일 (화) · 오늘')
      const real = b.tasks.setStatus.getMockImplementation()!
      let release!: () => void
      b.tasks.setStatus.mockImplementationOnce(async (id: unknown, status: unknown) => {
        await new Promise<void>((resolve) => (release = resolve))
        return real(id as never, status as never)
      })
      const box = (): HTMLElement => within(dialog).getByRole('checkbox', { name: m.toggleLabel('I 반복') })
      await user.click(box())
      await user.click(box())
      expect(b.tasks.setStatus).toHaveBeenCalledTimes(1)
      await act(async () => release())

      await waitFor(() => expect(b.t.repo.listRange(T, T).find((x) => x.title === 'I 반복')?.status).toBe('done'))
      await waitFor(() => expect(rowsIn(T1).filter((t) => t === 'I 반복')).toHaveLength(1))

      await user.click(within(dialog).getByRole('checkbox', { name: m.toggleLabel('I 반복') }))
      await waitFor(() => expect(rowsIn(T1).filter((t) => t === 'I 반복')).toHaveLength(0))
    })

    it('a failed completion is shown on the row and the checkbox does not pretend it changed', async () => {
      const { dialog, user } = await openDay(T, '2026년 11월 24일 (화) · 오늘')
      b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      await user.click(within(dialog).getByRole('checkbox', { name: m.toggleLabel('B 시간없음') }))
      expect(await within(dialog).findByText(m.rowFailed)).toBeTruthy()
      expect((within(dialog).getByRole('checkbox', { name: m.toggleLabel('B 시간없음') }) as HTMLInputElement).checked).toBe(false)
      expect(b.t.repo.listRange(T, T).find((x) => x.title === 'B 시간없음')?.status).toBe('open')
    })
  })

  describe('editing through the existing detail flow (C2-07)', () => {
    it('C2-07: changing the date of C in the detail moves it: gone from the old day, one copy on the new day', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.click(within(dialog).getByRole('button', { name: m.editButton('C 내일') }))
      const editor = within(dialog).getByRole('complementary', { name: ko.tasks.detail.title })
      fireEvent.change(editor.querySelector('#task-date') as HTMLInputElement, { target: { value: T2 } })
      await user.click(within(editor).getByRole('button', { name: ko.tasks.detail.save }))

      await waitFor(() => expect(rowsIn(T1)).not.toContain('C 내일'))
      expect(rowsIn(T2).filter((t) => t === 'C 내일')).toHaveLength(1)
      await waitFor(() => expect(countOf(T1)).not.toContain('할 일'))
      expect(await within(dialog).findByText(m.movedNotice('2026년 11월 26일 (목)'))).toBeTruthy()
    })

    it('editing with unsaved changes asks before leaving the editor', async () => {
      const { dialog, user } = await openDay(T1, '2026년 11월 25일 (수)')
      await user.click(within(dialog).getByRole('button', { name: m.editButton('C 내일') }))
      const editor = within(dialog).getByRole('complementary', { name: ko.tasks.detail.title })
      await user.type(within(editor).getByLabelText(ko.tasks.detail.titleField), ' 고침')
      // 편집 창 '닫기'(origin/dev 에서 '취소'는 할 일 취소로 바뀌었다)
      await user.click(within(editor).getByRole('button', { name: ko.tasks.detail.close }))
      expect(within(dialog).getByText(m.editDiscardTitle)).toBeTruthy()
      expect(within(dialog).queryByText('C 내일 고침')).toBeNull()
    })
  })

  describe('other screens and drafts (C2-06, C2-10)', () => {
    it('C2-10: a data change from elsewhere keeps the memo draft, the shown month and the selected day', async () => {
      const user = userEvent.setup()
      const card = await home()
      await user.click(within(card).getByRole('button', { name: m.nextMonth }))
      expect(within(card).getByText('2026년 12월')).toBeTruthy()
      await user.click(cell('2026-12-02'))
      await screen.findByRole('dialog')
      await user.keyboard('{Escape}')

      const memoInput = screen.getByLabelText(ko.home.memo.quickLabel) as HTMLTextAreaElement
      await user.type(memoInput, '작성 중인 메모')
      b.t.repo.create({ title: '다른 곳에서 추가', date: '2026-12-03' })
      await act(async () => notifyDataChanged())

      await waitFor(() => expect(countOf('2026-12-03')).toContain('할 일 1개'))
      expect(within(card).getByText('2026년 12월')).toBeTruthy()
      expect(cell('2026-12-02').getAttribute('aria-pressed')).toBe('true')
      expect((screen.getByLabelText(ko.home.memo.quickLabel) as HTMLTextAreaElement).value).toBe('작성 중인 메모')
    })

    it('C2-06: a task added from the day detail appears on the 오늘 할 일 card; the memo draft there is kept', async () => {
      const user = userEvent.setup()
      await home()
      await user.type(screen.getByLabelText(ko.home.memo.quickLabel), '메모 초안')
      await user.click(cell(T))
      const dialog = await dialogFor('2026년 11월 24일 (화) · 오늘')
      await user.type(titleField(dialog), '오늘 추가');
      await user.click(addButton(dialog))
      await waitFor(() => expect(rowsIn(T)).toContain('오늘 추가'))
      await user.keyboard('{Escape}')
      expect(screen.getByRole('region', { name: ko.home.cards.todo }).textContent).toContain('오늘 추가')
      expect((screen.getByLabelText(ko.home.memo.quickLabel) as HTMLTextAreaElement).value).toBe('메모 초안')
    })

    it('regression: the tasks screen still shows a change made elsewhere after the data event', async () => {
      const user = userEvent.setup()
      await home()
      await user.click(screen.getByRole('button', { name: ko.nav.tasks }))
      await screen.findByRole('navigation', { name: '보기' })
      b.t.repo.create({ title: '할 일 화면 갱신', date: T })
      act(() => notifyDataChanged())
      expect(await screen.findByText('할 일 화면 갱신')).toBeTruthy()
    })

    it('regression: the memos screen still shows a memo added elsewhere after the data event', async () => {
      const user = userEvent.setup()
      await home()
      await user.click(screen.getByRole('button', { name: ko.nav.memos }))
      await screen.findAllByRole('main')
      b.memoRepo.create('메모 화면 갱신')
      act(() => notifyDataChanged())
      expect(await screen.findByText('메모 화면 갱신')).toBeTruthy()
    })
  })
})

describe('C2 routines, Google navigation guard and routines screen', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 24, 12))
    b = installBackend('home')
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
    vi.useRealTimers()
  })

  it('C2-08: a routine item shown in the day detail keeps its date and bucket locked in the existing editor', async () => {
    const user = userEvent.setup()
    b.routineRepo.create({ title: '아침 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, T)
    render(<App />)
    await waitFor(() => expect(cell(T)).toBeTruthy())
    await user.click(cell(T))
    const dialog = await dialogFor('2026년 11월 24일 (화) · 오늘')
    await user.click(await within(dialog).findByRole('button', { name: m.editButton('아침 스트레칭') }))
    const editor = within(dialog).getByRole('complementary', { name: ko.tasks.detail.title })
    expect((editor.querySelector('#task-date') as HTMLInputElement).disabled).toBe(true)
    expect((editor.querySelector('#task-bucket') as HTMLSelectElement).disabled).toBe(true)
  })

  it('C2-10: when Google is not connected the day detail has no Google section or connect button (connecting is on the Arms screen)', async () => {
    const user = userEvent.setup()
    b.calendarState.status = { state: 'off' }
    render(<App />)
    await waitFor(() => expect(cell(T)).toBeTruthy())
    await user.click(cell(T))
    const dialog = await dialogFor('2026년 11월 24일 (화) · 오늘')
    expect(within(dialog).queryByRole('button', { name: ko.home.calendar.connect })).toBeNull()
    expect(within(dialog).queryByRole('region', { name: m.googleSection })).toBeNull()
  })

  it('regression: the routines screen shows a routine added elsewhere after the data event', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(cell(T)).toBeTruthy())
    await user.click(screen.getByRole('button', { name: ko.nav.routines }))
    await screen.findAllByRole('main')
    b.routineRepo.create({ title: '루틴 화면 갱신', days: [0, 1, 2, 3, 4, 5, 6] }, T)
    act(() => notifyDataChanged())
    expect((await screen.findAllByText('루틴 화면 갱신')).length).toBeGreaterThan(0)
  })
})

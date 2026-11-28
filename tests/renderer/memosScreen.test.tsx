// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyDataChanged } from '../../src/renderer/dataEvents'
import { ko } from '../../src/renderer/i18n/ko'
import { MemosScreen } from '../../src/renderer/memos/MemosScreen'
import { installBackend, type Backend } from './backend'

const t = ko.memos
const CTRL_ENTER = '{Control>}{Enter}{/Control}'

describe('memos screen', () => {
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

  const renderScreen = (): void => void render(<MemosScreen searchDebounceMs={0} />)
  const list = (): HTMLElement => screen.getByRole('region', { name: t.listLabel })
  const input = (): HTMLTextAreaElement => screen.getByLabelText(t.newLabel) as HTMLTextAreaElement

  /** 시계를 옮겨 가며 메모를 만든다(수정 시각이 서로 다르게). 끝나면 시계를 3/10 정오로 되돌린다. */
  function seed(...bodies: string[]) {
    const memos = bodies.map((body, index) => {
      vi.setSystemTime(new Date(2026, 2, 1 + index, 9, 0, 0))
      b.t.setNow(new Date().toISOString())
      return b.memoRepo.create(body)
    })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    b.t.setNow(new Date().toISOString())
    return memos
  }

  describe('writing a memo', () => {
    it('Ctrl+Enter saves it, clears the box and shows it in the list', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty)

      await user.type(input(), '장보기 목록{Enter}- 우유{Enter}- 달걀')
      expect(b.memos.create).not.toHaveBeenCalled() // 그냥 Enter 는 줄바꿈일 뿐
      await user.keyboard(CTRL_ENTER)

      await waitFor(() => expect(b.memos.create).toHaveBeenCalledWith('장보기 목록\n- 우유\n- 달걀'))
      await waitFor(() => expect(input().value).toBe(''))
      const body = await within(list()).findByText((text) => text.startsWith('장보기 목록'))
      expect(body.textContent).toBe('장보기 목록\n- 우유\n- 달걀')
      expect(screen.queryByText(t.empty)).toBeNull()
    })

    it('does not save while a Korean character is still being composed', async () => {
      renderScreen()
      await screen.findByText(t.empty)
      fireEvent.change(input(), { target: { value: '회의 메모' } })

      fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true, isComposing: true })
      expect(b.memos.create).not.toHaveBeenCalled()

      fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(b.memos.create).toHaveBeenCalledWith('회의 메모'))
    })

    it('the save button works too, and it is disabled for blank text', async () => {
      const user = userEvent.setup()
      renderScreen()
      await screen.findByText(t.empty)
      const save = screen.getAllByRole('button', { name: t.save })[0] as HTMLButtonElement
      expect(save.disabled).toBe(true)

      await user.type(input(), '   ')
      expect(save.disabled).toBe(true)
      await user.keyboard(CTRL_ENTER)
      expect(b.memos.create).not.toHaveBeenCalled()

      await user.type(input(), '내용')
      expect(save.disabled).toBe(false)
      await user.click(save)
      await waitFor(() => expect(b.memos.create).toHaveBeenCalledWith('   내용'))
    })

    it('shows an error and keeps the text when saving fails', async () => {
      const user = userEvent.setup()
      b.memos.create.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      renderScreen()
      await screen.findByText(t.empty)

      await user.type(input(), '지키고 싶은 글')
      await user.keyboard(CTRL_ENTER)

      expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect(input().value).toBe('지키고 싶은 글')
    })

    it('shows the message next to the box when the server says the body is empty', async () => {
      const user = userEvent.setup()
      b.memos.create.mockResolvedValueOnce({ ok: false, error: { code: 'invalid_input', fields: ['body'] } })
      renderScreen()
      await screen.findByText(t.empty)

      await user.type(input(), '내용')
      await user.keyboard(CTRL_ENTER)

      expect(await screen.findByText(t.fieldErrors.body)).toBeTruthy()
    })
  })

  describe('the list', () => {
    it('shows pinned memos first with a badge, then the newest, with the update time', async () => {
      const [oldest, , newest] = seed('가장 오래된 메모', '중간 메모', '가장 최근 메모')
      b.memoRepo.togglePin(oldest.id)
      renderScreen()

      await screen.findByText('가장 최근 메모')
      const items = within(list()).getAllByRole('listitem')
      expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual(['가장 오래된 메모', '가장 최근 메모', '중간 메모'])
      expect(within(items[0]).getByText(t.pinned, { selector: 'span' })).toBeTruthy()
      expect(within(items[1]).queryByText(t.pinned, { selector: 'span' })).toBeNull()
      expect(within(items[1]).getByText(t.updated('3/3 (화) 09:00'))).toBeTruthy()
      expect(newest.id).toBeTruthy()
    })

    it('pinning moves a memo to the top and the button turns into "고정 해제"', async () => {
      const user = userEvent.setup()
      const [first] = seed('먼저 만든 메모', '나중에 만든 메모')
      renderScreen()
      await screen.findByText('나중에 만든 메모')

      const firstCard = within(list()).getByText('먼저 만든 메모').closest('li') as HTMLElement
      await user.click(within(firstCard).getByRole('button', { name: t.pin }))

      await waitFor(() => expect(b.memos.togglePin).toHaveBeenCalledWith(first.id))
      await waitFor(() => expect(within(list()).getAllByRole('listitem')[0].textContent).toContain('먼저 만든 메모'))
      expect(within(list()).getByRole('button', { name: t.unpin })).toBeTruthy()
    })

    it('shows memo text as plain text: no HTML is interpreted, line breaks are kept', async () => {
      seed('<img src=x onerror="alert(1)"> <b>굵게</b>\n둘째 줄')
      renderScreen()

      const paragraph = (await within(list()).findByText((text) => text.includes('굵게'))) as HTMLElement
      expect(paragraph.textContent).toBe('<img src=x onerror="alert(1)"> <b>굵게</b>\n둘째 줄')
      expect(list().querySelector('img')).toBeNull()
      expect(list().querySelector('b')).toBeNull()
      expect(paragraph.className).toContain('whitespace-pre-wrap')
    })

    it('says what to do when there are no memos', async () => {
      renderScreen()

      expect(await screen.findByText(t.empty)).toBeTruthy()
    })
  })

  describe('search', () => {
    it('searches the text and shows only matches; clearing shows everything', async () => {
      const user = userEvent.setup()
      seed('장보기: 우유와 달걀', '팀 회의 안건', '우유 영수증 정리')
      renderScreen()
      await screen.findByText('팀 회의 안건')

      await user.type(screen.getByLabelText(t.searchLabel), '우유')

      await waitFor(() => expect(b.memos.search).toHaveBeenLastCalledWith('우유'))
      await waitFor(() => expect(within(list()).queryByText('팀 회의 안건')).toBeNull())
      expect(within(list()).getAllByRole('listitem')).toHaveLength(2)

      await user.clear(screen.getByLabelText(t.searchLabel))
      expect(await within(list()).findByText('팀 회의 안건')).toBeTruthy()
      expect(within(list()).getAllByRole('listitem')).toHaveLength(3)
    })

    it('says so when nothing matches', async () => {
      const user = userEvent.setup()
      seed('장보기')
      renderScreen()
      await screen.findByText('장보기')

      await user.type(screen.getByLabelText(t.searchLabel), '없는낱말')

      expect(await screen.findByText(t.noResults)).toBeTruthy()
    })

    it('a new memo saved during a search still respects the search', async () => {
      const user = userEvent.setup()
      seed('우유 메모')
      renderScreen()
      await screen.findByText('우유 메모')
      await user.type(screen.getByLabelText(t.searchLabel), '우유')
      await waitFor(() => expect(b.memos.search).toHaveBeenCalled())

      await user.type(input(), '관련 없는 새 메모')
      await user.keyboard(CTRL_ENTER)

      await waitFor(() => expect(b.memos.create).toHaveBeenCalled())
      await waitFor(() => expect(b.memos.search.mock.calls.length).toBeGreaterThan(1))
      expect(within(list()).queryByText('관련 없는 새 메모')).toBeNull()
    })
  })

  describe('editing', () => {
    it('clicking a memo opens an editor; Ctrl+Enter saves with update', async () => {
      const user = userEvent.setup()
      const [memo] = seed('고칠 메모')
      renderScreen()

      await user.click(await within(list()).findByText('고칠 메모'))
      const editor = (await screen.findByLabelText(t.editLabel)) as HTMLTextAreaElement
      expect(editor.value).toBe('고칠 메모')
      await user.type(editor, ' (수정)')
      await user.keyboard(CTRL_ENTER)

      await waitFor(() => expect(b.memos.update).toHaveBeenCalledWith(memo.id, '고칠 메모 (수정)'))
      expect(await within(list()).findByText('고칠 메모 (수정)')).toBeTruthy()
      expect(screen.queryByLabelText(t.editLabel)).toBeNull()
    })

    it('Esc and "취소" leave the memo as it was', async () => {
      const user = userEvent.setup()
      seed('그대로 둘 메모')
      renderScreen()

      await user.click(await within(list()).findByText('그대로 둘 메모'))
      await user.type(await screen.findByLabelText(t.editLabel), ' 지우면 안 됨')
      await user.keyboard('{Escape}')

      expect(screen.queryByLabelText(t.editLabel)).toBeNull()
      expect(b.memos.update).not.toHaveBeenCalled()
      expect(within(list()).getByText('그대로 둘 메모')).toBeTruthy()

      await user.click(within(list()).getByText('그대로 둘 메모'))
      await user.click(within(list()).getByRole('button', { name: t.cancel }))
      expect(screen.queryByLabelText(t.editLabel)).toBeNull()
    })

    it('an empty edit shows the message and stays open', async () => {
      const user = userEvent.setup()
      seed('비울 메모')
      renderScreen()

      await user.click(await within(list()).findByText('비울 메모'))
      await user.clear(await screen.findByLabelText(t.editLabel))
      await user.keyboard(CTRL_ENTER)

      expect(await within(list()).findByText(t.fieldErrors.body)).toBeTruthy()
      expect(screen.getByLabelText(t.editLabel)).toBeTruthy()
    })
  })

  describe('making a task', () => {
    it('"할 일로 만들기" creates the task from the first line and shows "할 일 있음"', async () => {
      const user = userEvent.setup()
      const [memo] = seed('내일 오후 3시 치과 예약\n전화번호 확인')
      renderScreen()
      const card = (await within(list()).findByText((text) => text.startsWith('내일 오후 3시'))).closest('li') as HTMLElement

      await user.click(within(card).getByRole('button', { name: t.toTask }))

      await waitFor(() => expect(b.memos.toTask).toHaveBeenCalledWith(memo.id))
      expect((await screen.findByRole('status')).textContent).toContain(t.madeTask)
      await waitFor(() => expect(within(card).queryByRole('button', { name: t.toTask })).toBeNull())
      expect(within(card).getByText(t.hasTask)).toBeTruthy()

      const task = b.t.repo.listView('upcoming', '2026-03-10')[0]
      expect(task).toMatchObject({ title: '치과 예약', notes: '전화번호 확인', date: '2026-03-11', time: '15:00' })
      expect(b.memoRepo.get(memo.id)?.taskId).toBe(task.id)
    })

    it('a memo that already has a task shows "할 일 있음" and no button', async () => {
      const [memo] = seed('이미 할 일이 된 메모')
      b.memoRepo.toTask(memo.id, '2026-03-10')
      renderScreen()

      const card = (await within(list()).findByText('이미 할 일이 된 메모')).closest('li') as HTMLElement
      expect(within(card).getByText(t.hasTask)).toBeTruthy()
      expect(within(card).queryByRole('button', { name: t.toTask })).toBeNull()
    })

    it('shows an error and no success message when it fails', async () => {
      const user = userEvent.setup()
      seed('실패할 메모')
      b.memos.toTask.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      renderScreen()

      await user.click(await within(list()).findByRole('button', { name: t.toTask }))

      expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  describe('deleting', () => {
    it('asks first; cancelling keeps the memo, confirming deletes it (the task stays)', async () => {
      const user = userEvent.setup()
      const [memo] = seed('지울 메모')
      const { task } = b.memoRepo.toTask(memo.id, '2026-03-10')
      renderScreen()
      const card = (await within(list()).findByText('지울 메모')).closest('li') as HTMLElement

      await user.click(within(card).getByRole('button', { name: t.remove }))
      const dialog = within(card).getByRole('alertdialog')
      expect(within(dialog).getByText(t.confirmRemove)).toBeTruthy()
      expect(b.memos.remove).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: t.cancel }))
      expect(within(card).queryByRole('alertdialog')).toBeNull()

      await user.click(within(card).getByRole('button', { name: t.remove }))
      await user.click(within(within(card).getByRole('alertdialog')).getByRole('button', { name: t.confirmRemoveYes }))

      await waitFor(() => expect(b.memos.remove).toHaveBeenCalledWith(memo.id))
      await waitFor(() => expect(within(list()).queryByText('지울 메모')).toBeNull())
      expect(b.t.repo.get(task.id)).toBeDefined()
    })
  })

  it('shows db_unavailable when the memos cannot be loaded', async () => {
    b.memos.list.mockResolvedValue({ ok: false, error: { code: 'db_unavailable' } })
    renderScreen()

    expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.db_unavailable)
  })

  describe('keeping unsaved text', () => {
    const leaveStrip = (title: string): HTMLElement => screen.getByRole('group', { name: title })
    const keepWriting = { name: ko.home.localCalendar.discardNo }
    const discard = { name: ko.home.localCalendar.discardYes }
    const editBox = (): HTMLTextAreaElement => screen.getByLabelText(t.editLabel) as HTMLTextAreaElement
    const editButton = (body: string): HTMLElement => screen.getByRole('button', { name: `${t.edit}: ${body}` })

    it('a data change keeps the draft and the edit box', async () => {
      const user = userEvent.setup()
      seed('첫 메모')
      renderScreen()
      await within(list()).findByText('첫 메모')
      await user.type(input(), '초안 글')
      const draft = input()

      const before = b.memos.list.mock.calls.length
      act(() => notifyDataChanged())
      await waitFor(() => expect(b.memos.list.mock.calls.length).toBeGreaterThan(before))

      expect(input()).toBe(draft)
      expect(input().value).toBe('초안 글')
    })

    it('opening another memo while the draft has text asks; keep writing stays, discard clears and opens', async () => {
      const user = userEvent.setup()
      seed('첫 메모', '둘째 메모')
      renderScreen()
      await within(list()).findByText('첫 메모')
      await user.type(input(), '쓰던 초안')

      await user.click(editButton('둘째 메모'))
      expect(leaveStrip(ko.home.localCalendar.discardTitle)).toBeTruthy()
      expect(screen.queryByLabelText(t.editLabel)).toBeNull()

      await user.click(within(leaveStrip(ko.home.localCalendar.discardTitle)).getByRole('button', keepWriting))
      expect(input().value).toBe('쓰던 초안')
      expect(screen.queryByLabelText(t.editLabel)).toBeNull()

      await user.click(editButton('둘째 메모'))
      await user.click(within(leaveStrip(ko.home.localCalendar.discardTitle)).getByRole('button', discard))
      expect(editBox().value).toBe('둘째 메모')
      expect(input().value).toBe('')
    })

    it('opening another memo while an edit has changes asks; keep editing stays', async () => {
      const user = userEvent.setup()
      seed('첫 메모', '둘째 메모')
      renderScreen()
      await within(list()).findByText('첫 메모')
      await user.click(editButton('첫 메모'))
      await user.type(editBox(), ' 고침')

      await user.click(editButton('둘째 메모'))
      expect(leaveStrip(ko.home.localCalendar.editDiscardTitle)).toBeTruthy()
      await user.click(within(leaveStrip(ko.home.localCalendar.editDiscardTitle)).getByRole('button', keepWriting))
      expect(editBox().value).toBe('첫 메모 고침')

      await user.click(editButton('둘째 메모'))
      await user.click(within(leaveStrip(ko.home.localCalendar.editDiscardTitle)).getByRole('button', discard))
      expect(editBox().value).toBe('둘째 메모')
    })

    it('opening another memo with nothing unsaved moves at once', async () => {
      const user = userEvent.setup()
      seed('첫 메모', '둘째 메모')
      renderScreen()
      await within(list()).findByText('첫 메모')
      await user.click(editButton('첫 메모'))

      await user.click(editButton('둘째 메모'))

      expect(editBox().value).toBe('둘째 메모')
      expect(screen.queryByRole('group', { name: ko.home.localCalendar.editDiscardTitle })).toBeNull()
    })
  })
})

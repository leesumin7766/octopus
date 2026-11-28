// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { RowMenu } from '../../src/renderer/ui/RowMenu'
import { installBackend, type Backend } from './backend'

// N6: 행마다 늘 보이는 ⋯(더보기) 버튼 → role="menu". 마우스 없이 Tab·Enter·화살표만으로 쓸 수 있다.
const t = ko.tasks
const TODAY = '2026-11-25'

describe('RowMenu', () => {
  afterEach(cleanup)

  function setup() {
    const first = vi.fn()
    const second = vi.fn()
    render(
      <div>
        <RowMenu title="보고서" items={[{ label: '하나', onSelect: first }, { label: '둘', onSelect: second, danger: true }]} />
        <button type="button">바깥</button>
      </div>
    )
    return { first, second, button: screen.getByRole('button', { name: ko.rowMenu.more('보고서') }) }
  }

  it('opens with Enter, focuses the first item, moves with arrows (wrapping), runs with Enter', async () => {
    const user = userEvent.setup()
    const { first, second, button } = setup()
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    button.focus()
    await user.keyboard('{Enter}')
    const menu = screen.getByRole('menu', { name: ko.rowMenu.menu('보고서') })
    const items = within(menu).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[0])
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(items[1])
    await user.keyboard('{Enter}')
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens with Space and ArrowDown too', async () => {
    const user = userEvent.setup()
    const { button } = setup()
    button.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('Esc closes and returns focus to ⋯; a click outside closes', async () => {
    const user = userEvent.setup()
    const { button } = setup()
    await user.click(button)
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)

    await user.click(button)
    fireEvent.mouseDown(screen.getByRole('button', { name: '바깥' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders nothing when there are no actions', () => {
    render(<RowMenu title="빈" items={[]} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('rows have a ⋯ menu', () => {
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

  const moreOf = (title: string): HTMLElement => screen.getByRole('button', { name: ko.rowMenu.more(title) })

  it('task row: keyboard only — Tab to ⋯, Enter, arrows to 안 하기, Enter → canceled', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    const task = b.t.repo.create({ title: '키보드 정리', date: TODAY })
    render(<App />)
    const more = await screen.findByRole('button', { name: ko.rowMenu.more('키보드 정리') })
    more.focus()
    await user.keyboard('{Enter}')
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([t.rowMenu.edit, t.detail.moveToSomeday, t.detail.cancelTask, t.detail.remove])
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('canceled'))
  })

  it('task row menu: edit opens the detail, 나중에로 moves it, 삭제 asks first', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    const a = b.t.repo.create({ title: '편집할 정리', date: TODAY })
    const s = b.t.repo.create({ title: '미룰 정리', date: TODAY })
    const d = b.t.repo.create({ title: '삭제할 정리', date: TODAY })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: ko.rowMenu.more('편집할 정리') }))
    await user.click(screen.getByRole('menuitem', { name: t.rowMenu.edit }))
    expect((await screen.findByRole('complementary', { name: t.detail.title })).textContent).toContain(t.detail.save)
    await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: t.detail.close }))

    await user.click(moreOf('미룰 정리'))
    await user.click(screen.getByRole('menuitem', { name: t.detail.moveToSomeday }))
    await waitFor(() => expect(b.t.repo.get(s.id)?.bucket).toBe('someday'))

    await user.click(await screen.findByRole('button', { name: ko.rowMenu.more('삭제할 정리') }))
    await user.click(screen.getByRole('menuitem', { name: t.detail.remove }))
    expect(screen.getByRole('alertdialog', { name: t.detail.confirmRemove })).toBeTruthy()
    expect(b.t.repo.get(d.id)).toBeDefined()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: t.detail.confirmRemoveYes }))
    await waitFor(() => expect(b.t.repo.get(d.id)).toBeUndefined())
    expect(b.t.repo.get(a.id)).toBeDefined()
  })

  it('checklist items and repeating tasks leave out actions that are not allowed', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    b.routineRepo.create({ title: '체크 항목', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
    b.t.repo.create({ title: '반복 정리', date: TODAY, repeat: { freq: 'daily', interval: 1 } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: ko.rowMenu.more('체크 항목') }))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([t.rowMenu.edit])
    await user.keyboard('{Escape}')
    await user.click(moreOf('반복 정리'))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([t.rowMenu.edit, t.detail.cancelTask, t.detail.remove])
  })

  it('안 하기로 함 row: keyboard only → 다시 열기', async () => {
    const user = userEvent.setup()
    b = installBackend('done')
    const task = b.t.repo.create({ title: '안 한 정리', date: TODAY })
    b.t.repo.setStatus(task.id, 'canceled')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: t.doneFilter.canceled }))
    const more = await screen.findByRole('button', { name: ko.rowMenu.more('안 한 정리') })
    more.focus()
    await user.keyboard('{Enter}')
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([t.reopen])
    await user.keyboard('{Enter}')
    await waitFor(() => expect(b.t.repo.get(task.id)?.status).toBe('open'))
  })

  it('memo row: keyboard only → 할 일로 만들기; the menu also has edit, pin, delete', async () => {
    const user = userEvent.setup()
    b = installBackend('memos')
    const memo = b.memoRepo.create('치과 예약 전화')
    render(<App />)
    const more = await screen.findByRole('button', { name: ko.rowMenu.more('치과 예약 전화') })
    more.focus()
    await user.keyboard('{Enter}')
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([ko.memos.edit, ko.memos.pin, ko.memos.toTask, ko.memos.remove])
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(b.memos.toTask).toHaveBeenCalledWith(memo.id))
    expect(await screen.findByText(ko.memos.madeTask)).toBeTruthy()
  })

  it('memo row: delete from the menu asks first', async () => {
    const user = userEvent.setup()
    b = installBackend('memos')
    b.memoRepo.create('지울 메모 하나')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: ko.rowMenu.more('지울 메모 하나') }))
    await user.click(screen.getByRole('menuitem', { name: ko.memos.remove }))
    expect(screen.getByRole('alertdialog', { name: ko.memos.confirmRemove })).toBeTruthy()
    expect(b.memos.remove).not.toHaveBeenCalled()
  })
})

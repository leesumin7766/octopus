// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// F6: 할 일 탭 검색 — 제목·설명에서, 모든 보기와 안 하기로 함에서 보기별로 묶어 보여 주고, 누르면 그 보기에서 선택한다.
const t = ko.tasks
const TODAY = '2026-11-25'

describe('task search', () => {
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

  function seed(): void {
    b.t.repo.create({ title: '수신함 보고서' })
    b.t.repo.create({ title: '오늘 보고서', date: TODAY })
    b.t.repo.create({ title: '예정 보고서', date: '2026-12-02' })
    const later = b.t.repo.create({ title: '나중 보고서' })
    b.t.repo.moveToSomeday([later.id])
    const done = b.t.repo.create({ title: '끝낸 보고서', date: TODAY })
    b.t.repo.setStatus(done.id, 'done')
    const canceled = b.t.repo.create({ title: '안 한 보고서', date: TODAY })
    b.t.repo.setStatus(canceled.id, 'canceled')
    b.t.repo.create({ title: '점검', notes: '분기 보고서 참고해서 정리' })
    b.t.repo.create({ title: '무관한 일정 하나' })
  }

  const box = (): HTMLInputElement => screen.getByRole('textbox', { name: t.search.label }) as HTMLInputElement
  const results = (): HTMLElement => screen.getByRole('region', { name: t.search.title })
  const detail = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: t.detail.title })

  async function start(view: 'today' | 'inbox' = 'today') {
    const user = userEvent.setup()
    b = installBackend(view)
    seed()
    render(<App />)
    await screen.findByRole('textbox', { name: t.search.label })
    return user
  }

  it('finds in every view (and 안 하기로 함), grouped by the view name, including the description', async () => {
    const user = await start()
    await user.type(box(), '보고서')
    await within(await screen.findByRole('region', { name: t.search.title })).findByText(t.search.summary(7))

    for (const [heading, title] of [
      [t.views.inbox, '수신함 보고서'],
      [t.views.today, '오늘 보고서'],
      [t.views.upcoming, '예정 보고서'],
      [t.views.someday, '나중 보고서'],
      [t.views.done, '끝낸 보고서'],
      [t.doneFilter.canceled, '안 한 보고서']
    ] as const) {
      const group = within(results()).getByRole('region', { name: heading })
      expect(within(group).getByRole('button', { name: t.search.resultLabel(heading, title) })).toBeTruthy()
    }
    // 설명에만 있는 낱말도 찾는다(점검 은 수신함 묶음)
    expect(within(results()).getByRole('button', { name: t.search.resultLabel(t.views.inbox, '점검') })).toBeTruthy()
    expect(within(results()).queryByText('무관한 일정 하나')).toBeNull()
    // 찾은 부분을 강조한다
    expect(results().querySelectorAll('mark').length).toBeGreaterThan(5)
  })

  it('ignores case and surrounding spaces', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    b.t.repo.create({ title: 'Alpha Report' })
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: t.search.label }), '  report ')
    expect(await within(await screen.findByRole('region', { name: t.search.title })).findByRole('button', { name: new RegExp('Alpha Report') })).toBeTruthy()
  })

  it('clicking a result goes to its view and selects it; the search ends', async () => {
    const user = await start()
    await user.type(box(), '예정 보')
    await user.click(await within(await screen.findByRole('region', { name: t.search.title })).findByRole('button', { name: t.search.resultLabel(t.views.upcoming, '예정 보고서') }))

    expect((await detail().then((panel) => within(panel).getByLabelText(t.detail.titleField))) as HTMLInputElement).toHaveProperty('value', '예정 보고서')
    expect(screen.getByRole('heading', { level: 1, name: t.views.upcoming })).toBeTruthy()
    expect(box().value).toBe('')
    expect(screen.queryByRole('region', { name: t.search.title })).toBeNull()
  })

  it('a 안 하기로 함 result opens in the 완료 view with that filter and selects it', async () => {
    const user = await start()
    await user.type(box(), '안 한')
    await user.click(await screen.findByRole('button', { name: t.search.resultLabel(t.doneFilter.canceled, '안 한 보고서') }))
    expect((await detail().then((panel) => within(panel).getByLabelText(t.detail.titleField))) as HTMLInputElement).toHaveProperty('value', '안 한 보고서')
    expect(screen.getByRole('button', { name: t.doneFilter.canceled, pressed: true })).toBeTruthy()
  })

  it('Esc ends the search and leaves the view as it was', async () => {
    const user = await start('inbox')
    expect(screen.getByRole('heading', { level: 1, name: t.views.inbox })).toBeTruthy()
    await user.type(box(), '보고서')
    await screen.findByRole('region', { name: t.search.title })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: t.search.title })).toBeNull()
    expect(box().value).toBe('')
    expect(screen.getByRole('heading', { level: 1, name: t.views.inbox })).toBeTruthy()
  })

  it('the clear button ends the search; no match shows a short note', async () => {
    const user = await start()
    await user.type(box(), '없는낱말')
    expect(await screen.findByText(t.search.empty('없는낱말'))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: t.search.clear }))
    expect(screen.queryByText(t.search.empty('없는낱말'))).toBeNull()
    expect(box().value).toBe('')
    expect(screen.getByRole('heading', { level: 1, name: t.views.today })).toBeTruthy()
  })

  it('with an unsaved detail edit, opening a result asks first', async () => {
    const user = await start()
    await user.click(await screen.findByText('오늘 보고서'))
    const panel = await detail()
    await user.type(within(panel).getByLabelText(t.detail.titleField), ' 고침')
    await user.type(box(), '수신함')
    await user.click(await screen.findByRole('button', { name: t.search.resultLabel(t.views.inbox, '수신함 보고서') }))

    expect(screen.getByText(ko.home.localCalendar.editDiscardTitle)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: ko.home.localCalendar.discardYes }))
    await waitFor(() => expect((within(screen.getByRole('complementary', { name: t.detail.title })).getByLabelText(t.detail.titleField) as HTMLInputElement).value).toBe('수신함 보고서'))
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { SCROLL_IDLE_MS } from '../../src/renderer/ui/useScrollingFlag'
import { defaultSetting } from '../../src/shared/settings/schema'
import { installBackend, type Backend } from './backend'

// ATDT 를 참고한 홈 개방감 정리: 창 제목 줄의 날짜, 스크롤할 때만 보이는 카드 스크롤바,
// 홈 '오늘 할 일' 입력칸의 Enter 안내 삭제, 왼쪽 메뉴 기본 접힘, 떠 있는 배치 안내.

describe('open home layout', () => {
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

  it('the date sits in the draggable title bar, not in a row above the cards', async () => {
    b = installBackend('home')
    const { container } = render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })

    const bar = container.querySelector('header.app-drag')
    expect(bar).not.toBeNull()
    expect(within(bar as HTMLElement).getByText('11월 25일 수요일').tagName).toBe('TIME')
    // 홈 제목은 화면 읽기용으로만 남는다(보이는 줄을 차지하지 않는다)
    const heading = screen.getByRole('heading', { level: 1, name: '11월 25일 수요일' })
    expect(heading.className).toContain('sr-only')
  })

  it('the title bar is also there on the first-run guide so the window can be moved', async () => {
    b = installBackend('home')
    b.settingsRepo.set('onboarding.done', false)
    const { container } = render(<App />)
    await screen.findByText(ko.onboarding.skip)
    expect(container.querySelector('header.app-drag')).not.toBeNull()
  })

  it('dialog backdrops are no-drag, so the title bar does not swallow clicks while one is open', async () => {
    const user = userEvent.setup()
    b = installBackend('home')
    render(<App />)
    const calendar = await screen.findByRole('region', { name: ko.home.cards.calendar })
    await user.click(within(calendar).getByRole('button', { name: /^2026년 11월 25일/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('.app-no-drag')).not.toBeNull()
  })

  it('a card shows its scrollbar only while the user scrolls it', async () => {
    b = installBackend('home')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.memo })
    // 화면이 뜬 뒤에 스크롤 타이머만 가짜로 돌린다
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
    const body = card.querySelector('.scroll-quiet') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.hasAttribute('data-scrolling')).toBe(false)

    fireEvent.scroll(body)
    expect(body.hasAttribute('data-scrolling')).toBe(true)
    await act(async () => vi.advanceTimersByTime(SCROLL_IDLE_MS - 100))
    fireEvent.scroll(body) // 계속 스크롤하면 유지
    await act(async () => vi.advanceTimersByTime(SCROLL_IDLE_MS - 100))
    expect(body.hasAttribute('data-scrolling')).toBe(true)
    await act(async () => vi.advanceTimersByTime(200))
    expect(body.hasAttribute('data-scrolling')).toBe(false)
  })

  it('the home today input has no Enter instruction; the tasks screen keeps its own', async () => {
    b = installBackend('home')
    render(<App />)
    const card = await screen.findByRole('region', { name: ko.home.cards.todo })
    const input = within(card).getByLabelText(ko.tasks.quickInputLabel) as HTMLInputElement
    expect(input.placeholder).toBe(ko.home.todo.inputPlaceholder)
    expect(input.placeholder).not.toContain('Enter')
    cleanup()
    b.t.db.close()

    b = installBackend('today')
    render(<App />)
    expect(((await screen.findByLabelText(ko.tasks.quickInputLabel)) as HTMLInputElement).placeholder).toBe(ko.tasks.quickInputPlaceholder)
  })

  it('the left menu starts collapsed when nothing is saved, and a saved choice still wins', async () => {
    expect(defaultSetting('nav.collapsed')).toBe(true)
    b = installBackend('home')
    b.settingsRepo.set('nav.collapsed', false)
    render(<App />)
    expect(await screen.findByRole('button', { name: ko.nav.collapse })).toBeTruthy()
  })

  it('the arrange notice floats instead of pushing the cards down', async () => {
    b = installBackend('home')
    render(<App />)
    await screen.findByRole('region', { name: ko.home.cards.todo })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: ko.nav.arrange }))
    const notice = screen.getByRole('status')
    expect(notice.textContent).toContain(ko.home.arranging)
    expect(notice.className).toContain('absolute')
  })
})

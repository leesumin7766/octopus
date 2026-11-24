// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { floatingShift } from '../../src/renderer/pie/PieMenu'
import { installBackend, type Backend } from './backend'

const t = ko.home
let b: Backend

function setWindowWidth(px: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px })
}

describe('home screen in a narrow window', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    setWindowWidth(700)
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
    setWindowWidth(1024)
  })

  it('stacks the cards in one column and hides the resize separators', async () => {
    b = installBackend('home')
    render(<App />)

    expect(await screen.findByRole('region', { name: t.cards.todo })).toBeTruthy()
    expect(screen.queryByRole('separator', { name: t.columnSeparator })).toBeNull()
    expect(screen.queryByRole('separator', { name: t.rowSeparator })).toBeNull()
  })

  it('keeps "전체 보기" below the scrolling part of the card, so it is always visible', async () => {
    b = installBackend('home')
    render(<App />)

    const todo = await screen.findByRole('region', { name: t.cards.todo })
    const viewAll = Array.from(todo.querySelectorAll('button')).find((el) => el.textContent === t.todo.viewAll)
    expect(viewAll).toBeTruthy()
    expect(viewAll?.closest('.overflow-auto')).toBeNull()
  })

  it('a wide window keeps the separators', async () => {
    setWindowWidth(1024)
    b = installBackend('home')
    render(<App />)

    expect(await screen.findByRole('separator', { name: t.columnSeparator })).toBeTruthy()
    expect(screen.getByRole('separator', { name: t.rowSeparator })).toBeTruthy()
  })
})

describe('floatingShift (the pie menu opened at the bottom-right corner of a narrow window)', () => {
  it('moves the menu left and up so its 320px circle stays inside the window', () => {
    // 원 버튼 중심은 오른쪽 아래에서 50px 떨어진 곳. 메뉴 반지름 160 + 여백 8 만큼은 창 안에 있어야 한다.
    expect(floatingShift(700, 700)).toEqual({ x: -118, y: -118 })
    expect(floatingShift(1200, 800)).toEqual({ x: -118, y: -118 })
  })

  it('a very small window clamps to the smallest allowed centre', () => {
    expect(floatingShift(300, 300)).toEqual({ x: -82, y: -82 })
  })
})

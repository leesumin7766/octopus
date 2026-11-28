// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// N1~N3 독립 검증(Opus): 화면에 실제로 그려진 글(본문·aria-label·placeholder·title)에 기준에서 뺀 말이 없다.
// ko.ts 만 훑는 시험과 달리, 화면 코드에 직접 적힌 글도 잡는다.
import { createElement, type ComponentType } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from '../renderer/backend'

const TODAY = '2026-11-26'
// 'Google 캘린더' 는 바깥 일정 이름이라 허용. 그 밖의 '캘린더' 는 달력.
const BANNED: [string, RegExp][] = [
  ['루틴', /루틴/],
  ['데일리/오늘의 체크리스트', /데일리 체크리스트|오늘의 체크리스트/],
  ['후보', /후보/],
  ['수정', /수정/],
  ['지우기류', /지우기|지워|지울|지웠/],
  ['캘린더(Google 제외)', /(?<!Google )캘린더/],
  ['구글', /구글/]
]

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

let b: Backend
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0))
  b = installBackend('home')
  // 사용자 데이터에는 금지어가 없게 만든다(화면 문구만 본다).
  b.t.repo.create({ title: '보고서', date: TODAY })
  b.t.repo.create({ title: '정리', date: '2026-11-25' })
  b.routineRepo.create({ title: '스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
  b.memoRepo.create('장보기 목록')
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.useRealTimers()
})

function visibleWords(): string {
  const parts: string[] = [document.body.textContent ?? '']
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(attr)
      if (v) parts.push(v)
    }
  }
  return parts.join('\n')
}

function expectClean(where: string): void {
  const text = visibleWords()
  const found = BANNED.filter(([, re]) => re.test(text)).map(([name, re]) => `${name}: …${text.slice(Math.max(0, text.search(re) - 15), text.search(re) + 15)}…`)
  expect(found, where).toEqual([])
}

describe('N1~N3 (Opus) rendered screens use only the standard words', () => {
  const screensToVisit: [string, string][] = [
    ['tasks', ko.nav.tasks],
    ['calendar', ko.nav.calendar],
    ['checklist', ko.nav.routines],
    ['memos', ko.nav.memos],
    ['arms', ko.nav.arms],
    ['settings', ko.nav.settings]
  ]

  it('home (with the pie menu open)', async () => {
    const user = userEvent.setup()
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    expectClean('home')
    await user.click(screen.getByRole('button', { name: ko.pie.menuLabel }))
    expectClean('home + pie menu')
  })

  it.each(screensToVisit)('%s', async (name, label) => {
    const user = userEvent.setup()
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: label }))
    // 화면마다 다 그려질 때까지 잠깐 기다린다(목록 읽기).
    await new Promise((r) => setTimeout(r, 150))
    expectClean(name)
  })

  it('task detail panel', async () => {
    const user = userEvent.setup()
    render(createElement(App))
    await screen.findByRole('region', { name: ko.home.cards.todo })
    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.tasks }))
    await user.click(await screen.findByText('보고서'))
    const detail = await screen.findByRole('complementary', { name: ko.tasks.detail.title })
    expect(within(detail).getByLabelText(ko.tasks.detail.notes)).toBeTruthy()
    expect(ko.tasks.detail.notes).toBe('설명')
    expectClean('task detail')
  })
})

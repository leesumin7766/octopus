// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// F2 독립 검증(Opus): 체크와 복구가 네 화면에서 같다. 줄은 응답 전에 그어지고, 알림은 하나, 6초는 새 알림마다 다시 센다.
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'
import type { IpcResult } from '../../src/shared/ipc'
import type { Task } from '../../src/shared/tasks/types'
import { installBackend, type Backend } from '../renderer/backend'

const t = ko.tasks
const TODAY = '2026-11-25'

let App: ComponentType
beforeAll(async () => {
  const p = '../../src/renderer/App'
  App = (await import(p)).App
})

let b: Backend
let user: ReturnType<typeof userEvent.setup>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
})
afterEach(() => {
  cleanup()
  b?.t.db.close()
  vi.useRealTimers()
})

const homeBox = (title: string): HTMLInputElement => screen.getByRole('checkbox', { name: `${t.complete}: ${title}` }) as HTMLInputElement
const dayBox = (title: string): HTMLInputElement => screen.getByRole('checkbox', { name: ko.home.localCalendar.toggleLabel(title) }) as HTMLInputElement
const notices = (): HTMLElement[] => screen.queryAllByRole('status').filter((el) => within(el).queryByRole('button', { name: t.undo.button }))
const idOf = (title: string): string => b.t.repo.listRange('2026-11-01', '2026-12-31').find((x) => x.title === title)!.id
const held = (): { promise: Promise<IpcResult<Task>>; release: (r: IpcResult<Task>) => void } => {
  let release!: (r: IpcResult<Task>) => void
  return { promise: new Promise((resolve) => (release = resolve)), release }
}

async function openHome(...titles: string[]): Promise<void> {
  b = installBackend('home')
  for (const title of titles) b.t.repo.create({ title, date: TODAY })
  render(createElement(App))
  const card = await screen.findByRole('region', { name: ko.home.cards.todo })
  for (const title of titles) await within(card).findByText(title)
}

async function openDay(title: string): Promise<void> {
  b = installBackend('home')
  b.t.repo.create({ title, date: TODAY })
  render(createElement(App))
  await waitFor(() => expect(document.querySelector(`[data-date="${TODAY}"]`)).toBeTruthy())
  await user.click(document.querySelector(`[data-date="${TODAY}"]`) as HTMLElement)
  await screen.findByRole('dialog')
  await waitFor(() => expect(dayBox(title)).toBeTruthy())
}

async function openChecklist(title: string): Promise<void> {
  b = installBackend('home')
  b.routineRepo.create({ title, days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
  render(createElement(App))
  await user.click(await screen.findByRole('button', { name: ko.nav.routines }))
  await waitFor(() => expect(homeBox(title)).toBeTruthy())
}

describe('F2 (Opus) the line is drawn before the save answers', () => {
  it.each([
    ['home card', () => openHome('홈 느린 일'), () => homeBox('홈 느린 일')],
    ['day detail', () => openDay('상세 느린 일'), () => dayBox('상세 느린 일')],
    ['checklist', () => openChecklist('느린 스트레칭'), () => homeBox('느린 스트레칭')]
  ])('%s', async (_name, open, box) => {
    await open()
    const slow = held()
    b.tasks.setStatus.mockImplementationOnce(() => slow.promise)
    await user.click(box())
    expect(box().checked).toBe(true) // 응답 전
    expect(notices()).toHaveLength(0) // 알림은 저장이 끝난 뒤
    await act(async () => slow.release({ ok: false, error: { code: 'internal' } })) // 실패하면 줄이 풀린다
    await waitFor(() => expect(box().checked).toBe(false))
  })
})

describe('F2 (Opus) undo timing and the single notice', () => {
  it('home: [되돌리기] pressed during the fade keeps the task on the card, open, not struck', async () => {
    await openHome('빨리 되돌릴 일')
    await user.click(homeBox('빨리 되돌릴 일'))
    const notice = await waitFor(() => {
      expect(notices()).toHaveLength(1)
      return notices()[0]
    })
    await user.click(within(notice).getByRole('button', { name: t.undo.button }))
    await act(async () => void vi.advanceTimersByTime(1000))
    await waitFor(() => expect(b.t.repo.get(idOf('빨리 되돌릴 일'))?.status).toBe('open'))
    expect(homeBox('빨리 되돌릴 일').checked).toBe(false)
  })

  it('home: a second check replaces the notice and restarts its 6 seconds', async () => {
    await openHome('첫째 일', '둘째 일')
    await user.click(homeBox('첫째 일'))
    await waitFor(() => expect(notices()).toHaveLength(1))
    await act(async () => void vi.advanceTimersByTime(5000))
    await user.click(homeBox('둘째 일'))
    await waitFor(() => expect(notices()[0]?.textContent).toContain(t.undo.done('둘째 일')))
    expect(notices()).toHaveLength(1)
    // 첫 알림 기준(6초)이면 이미 사라졌을 시각. 여유를 둬서 부하로 실제 시간이 더 흘러도 흔들리지 않게 한다.
    await act(async () => void vi.advanceTimersByTime(3000))
    expect(notices()).toHaveLength(1)
    await act(async () => void vi.advanceTimersByTime(4000))
    expect(notices()).toHaveLength(0)
  })

  it('home: a failed [되돌리기] shows an error and the task stays done', async () => {
    await openHome('못 되돌릴 일')
    await user.click(homeBox('못 되돌릴 일'))
    await waitFor(() => expect(notices()).toHaveLength(1))
    b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    await user.click(within(notices()[0]).getByRole('button', { name: t.undo.button }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(b.t.repo.get(idOf('못 되돌릴 일'))?.status).toBe('done')
  })

  it('day detail: clicking a checked row again unchecks it without a new notice', async () => {
    await openDay('다시 누를 일')
    await user.click(dayBox('다시 누를 일'))
    await waitFor(() => expect(b.t.repo.get(idOf('다시 누를 일'))?.status).toBe('done'))
    await act(async () => void vi.advanceTimersByTime(6500))
    expect(notices()).toHaveLength(0)
    await user.click(dayBox('다시 누를 일'))
    await waitFor(() => expect(b.t.repo.get(idOf('다시 누를 일'))?.status).toBe('open'))
    expect(dayBox('다시 누를 일').checked).toBe(false)
    expect(notices()).toHaveLength(0)
  })

  it('checklist: [되돌리기] reopens and the row stays in the list', async () => {
    await openChecklist('되돌릴 스트레칭')
    await user.click(homeBox('되돌릴 스트레칭'))
    await waitFor(() => expect(notices()).toHaveLength(1))
    expect(homeBox('되돌릴 스트레칭').checked).toBe(true)
    await user.click(within(notices()[0]).getByRole('button', { name: t.undo.button }))
    await waitFor(() => expect(homeBox('되돌릴 스트레칭').checked).toBe(false))
    expect(b.t.repo.get(idOf('되돌릴 스트레칭'))?.status).toBe('open')
  })
})

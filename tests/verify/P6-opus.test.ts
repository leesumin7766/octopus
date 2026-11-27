// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// P6 독립 검증(Opus): 업데이트 동작 실패 안내. 끝 기준 — 실패하면 문구, [다시 시도]는 같은 동작, 성공하면 사라짐.
import { createElement, Fragment, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBackend } from '../renderer/backend'
import { ko } from '../../src/renderer/i18n/ko'
import type { IpcResult } from '../../src/shared/ipc'
import type { UpdateState } from '../../src/shared/update/types'

let UpdateSection: ComponentType
let NoticeBell: ComponentType
beforeAll(async () => {
  const s = '../../src/renderer/settings/UpdateSection'
  const n = '../../src/renderer/notices/NoticeBell'
  UpdateSection = (await import(s)).UpdateSection
  NoticeBell = (await import(n)).NoticeBell
})

const fail = { ok: false, error: { code: 'internal' } } as const
const available: UpdateState = { status: 'available', current: '0.1.0', version: '0.2.0' }
const ready: UpdateState = { ...available, status: 'ready' }
const su = ko.settings.update
let b: ReturnType<typeof installBackend>

beforeEach(() => {
  b = installBackend()
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.restoreAllMocks()
})

function settings() {
  return within(screen.getByRole('region', { name: su.title }))
}
function bell() {
  return within(screen.getByRole('dialog', { name: ko.notices.panel }))
}
async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
  })
}
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
async function openBell() {
  const btn = screen.getByRole('button', { name: /알림/ })
  await click(btn)
}

describe('P6 (Opus)', () => {
  it('retry from the notification bell repeats the failed download and success clears both surfaces', async () => {
    Object.assign(b.updateState, available)
    render(createElement(Fragment, null, createElement(UpdateSection), createElement(NoticeBell)))
    await screen.findByRole('button', { name: su.download })
    await openBell()
    b.update.download.mockResolvedValueOnce(fail)
    await click(bell().getAllByRole('button').find((x) => x.textContent === ko.notices.update.download)!)
    expect(bell().getByRole('alert').textContent).toContain(ko.notices.update.failed.download)
    expect(settings().getByRole('alert').textContent).toContain(su.failed.download)
    await click(bell().getByRole('button', { name: ko.notices.update.retry }))
    expect(b.update.download).toHaveBeenCalledTimes(2)
    expect(b.update.check).not.toHaveBeenCalled()
    expect(b.update.install).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('install failure by rejected promise shows the error; retry while pending is disabled and sends one request', async () => {
    Object.assign(b.updateState, ready)
    render(createElement(UpdateSection))
    b.update.install.mockRejectedValueOnce(new Error('ipc gone'))
    await click(await screen.findByRole('button', { name: su.install }))
    expect(settings().getByRole('alert').textContent).toContain(su.failed.install)
    const slow = deferred<IpcResult<null>>()
    b.update.install.mockImplementationOnce(() => slow.promise)
    const retry = settings().getByRole('button', { name: su.retry })
    await click(retry)
    // 다시 시도를 누르면 이전 오류는 지워지고, 진행 중에는 설치 버튼이 잠긴다
    expect(screen.queryByText(su.failed.install)).toBeNull()
    expect((settings().getByRole('button', { name: su.install }) as HTMLButtonElement).disabled).toBe(true)
    await click(settings().getByRole('button', { name: su.install }))
    expect(b.update.install).toHaveBeenCalledTimes(2)
    await act(async () => slow.resolve({ ok: true, data: null }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('a check failure does not lock or hide a concurrently pending download, and the error names check', async () => {
    Object.assign(b.updateState, available)
    render(createElement(UpdateSection))
    await screen.findByRole('button', { name: su.download })
    const dl = deferred<IpcResult<UpdateState>>()
    b.update.download.mockImplementationOnce(() => dl.promise)
    await click(settings().getByRole('button', { name: su.download }))
    b.update.check.mockResolvedValueOnce(fail)
    await click(settings().getByRole('button', { name: su.check }))
    expect(settings().getByRole('alert').textContent).toContain(su.failed.check)
    expect((settings().getByRole('button', { name: su.download }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => dl.resolve({ ok: true, data: { ...available } }))
    // 늦게 끝난 받기 성공은 더 최근인 확인 실패를 지우지 않는다(마지막 요청이 이김)
    expect(settings().getByRole('alert').textContent).toContain(su.failed.check)
    await click(settings().getByRole('button', { name: su.retry }))
    expect(b.update.check).toHaveBeenCalledTimes(2)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('error survives while another subscriber stays mounted (bell open, settings re-mounted)', async () => {
    Object.assign(b.updateState, available)
    const both = () => createElement(Fragment, null, createElement(UpdateSection, { key: 's' }), createElement(NoticeBell, { key: 'n' }))
    const view = render(both())
    await screen.findByRole('button', { name: su.download })
    b.update.download.mockResolvedValueOnce(fail)
    await click(settings().getByRole('button', { name: su.download }))
    view.rerender(createElement(Fragment, null, createElement(NoticeBell, { key: 'n' })))
    expect(screen.queryByRole('region', { name: su.title })).toBeNull()
    view.rerender(both())
    await screen.findByRole('button', { name: su.download })
    expect(settings().getByRole('alert').textContent).toContain(su.failed.download)
  })

  it('a pushed status change clears a shown failure', async () => {
    Object.assign(b.updateState, available)
    render(createElement(UpdateSection))
    await screen.findByRole('button', { name: su.download })
    b.update.download.mockResolvedValueOnce(fail)
    await click(settings().getByRole('button', { name: su.download }))
    expect(screen.getByText(su.failed.download)).toBeTruthy()
    await act(async () => b.emitUpdate({ ...available, status: 'downloading', percent: 10 }))
    expect(screen.queryByText(su.failed.download)).toBeNull()
  })
})

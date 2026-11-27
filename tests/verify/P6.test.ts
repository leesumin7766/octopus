// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
import { createElement, Fragment, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBackend } from '../renderer/backend'
import type { IpcResult } from '../../src/shared/ipc'
import type { UpdateState } from '../../src/shared/update/types'

// Runtime imports accommodate the node tsconfig (verify is included without JSX).
let UpdateSection: ComponentType
let NoticeBell: ComponentType
beforeAll(async () => {
  const settings = '../../src/renderer/settings/UpdateSection'
  const bell = '../../src/renderer/notices/NoticeBell'
  UpdateSection = (await import(settings)).UpdateSection
  NoticeBell = (await import(bell)).NoticeBell
})
let b: ReturnType<typeof installBackend>
const failure = { ok: false, error: { code: 'internal' } } as const
const available: UpdateState = { status: 'available', current: '0.1.0', version: '0.2.0' }
const ready: UpdateState = { ...available, status: 'ready' }
const actions = ['check', 'download', 'install'] as const
type Action = typeof actions[number]
type Surface = 'settings' | 'bell'
const labels = { check: '업데이트 확인', download: '업데이트 받기', install: '다시 시작해서 설치' }
const errors = { check: '업데이트를 확인하지 못했어요.', download: '업데이트를 받지 못했어요.', install: '설치를 시작하지 못했어요.' }
const bellErrors = { download: '받지 못했어요.', install: '설치를 시작하지 못했어요.' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  b = installBackend()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('P6 forbids external requests') }))
})
afterEach(() => {
  cleanup()
  b.t.db.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function mount(action: Action = 'download') {
  Object.assign(b.updateState, action === 'install' ? ready : available)
  const view = render(createElement(Fragment, null, createElement(UpdateSection), createElement(NoticeBell)))
  await screen.findByRole('button', { name: labels[action] })
  fireEvent.click(await screen.findByRole('button', { name: '알림 1개 보기' }))
  return view
}
function area(surface: Surface) {
  return within(screen.getByRole(surface === 'settings' ? 'region' : 'dialog', {
    name: surface === 'settings' ? '업데이트' : '알림'
  }))
}
function button(action: Action, surface: Surface = 'settings') {
  return area(surface).getByRole<HTMLButtonElement>('button', {
    name: surface === 'bell' && action === 'download' ? '받기' : labels[action]
  })
}
async function click(node: HTMLElement) { await act(async () => { fireEvent.click(node) }) }
function hold(action: Action) {
  if (action === 'install') {
    const p = deferred<IpcResult<null>>()
    b.update.install.mockImplementationOnce(() => p.promise)
    return { fail: () => p.resolve(failure), succeed: () => p.resolve({ ok: true, data: null }) }
  }
  const p = deferred<IpcResult<UpdateState>>()
  b.update[action].mockImplementationOnce(() => p.promise)
  return { fail: () => p.resolve(failure), succeed: () => p.resolve({ ok: true, data: { ...b.updateState } }) }
}

describe.each(actions)('P6 %s', action => {
  it.each(['ok:false', 'rejection', 'throw'] as const)('reports %s and retries exactly the same action; success clears errors', async mode => {
    await mount(action)
    if (mode === 'ok:false') b.update[action].mockResolvedValueOnce(failure)
    else if (mode === 'rejection') b.update[action].mockRejectedValueOnce(new Error('transport failed'))
    else b.update[action].mockImplementationOnce(() => { throw new Error('synchronous failure') })
    await click(button(action))
    expect(area('settings').getByRole('alert').textContent).toContain(errors[action])
    if (action !== 'check') expect(area('bell').getByRole('alert').textContent).toContain(bellErrors[action])
    await click(area('settings').getByRole('button', { name: '다시 시도' }))
    for (const other of actions) expect(b.update[other]).toHaveBeenCalledTimes(other === action ? 2 : 0)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('slow request disables every visible entry and repeated clicks send one IPC', async () => {
    await mount(action)
    const pending = hold(action)
    await click(button(action))
    const buttons = action === 'check' ? [button(action)] : [button(action), button(action, 'bell')]
    for (const entry of buttons) {
      expect(entry.disabled).toBe(true)
      for (let i = 0; i < 5; i++) fireEvent.click(entry)
    }
    expect(b.update[action]).toHaveBeenCalledTimes(1)
    await act(async () => pending.succeed())
    expect(button(action).disabled).toBe(false)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('state change clears a completed failure in both surfaces', async () => {
    await mount(action)
    b.update[action].mockResolvedValueOnce(failure)
    await click(button(action))
    expect(area('settings').getByRole('alert')).toBeTruthy()
    act(() => b.emitUpdate(ready))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})

describe.each(['download', 'install'] as const)('P6 shared %s', action => {
  it.each(['settings', 'bell'] as const)('failure from %s can be retried from the other surface', async origin => {
    await mount(action)
    b.update[action].mockResolvedValueOnce(failure)
    await click(button(action, origin))
    expect(area('settings').getByRole('alert').textContent).toContain(errors[action])
    expect(area('bell').getByRole('alert').textContent).toContain(bellErrors[action])
    const other = origin === 'settings' ? 'bell' : 'settings'
    const pending = hold(action)
    await click(area(other).getByRole('button', { name: '다시 시도' }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(button(action, origin).disabled).toBe(true)
    await act(async () => pending.succeed())
    expect(b.update[action]).toHaveBeenCalledTimes(2)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('completed error is discarded when all subscribers unmount', async () => {
    const view = await mount(action)
    b.update[action].mockResolvedValueOnce(failure)
    await click(button(action))
    expect(area('settings').getByRole('alert')).toBeTruthy()
    view.unmount()
    await mount(action)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(button(action).disabled).toBe(false)
  })

  it.each(['before', 'after'] as const)('late failure arriving %s resubscription must not resurrect abandoned error', async timing => {
    const view = await mount(action)
    const old = hold(action)
    await click(button(action))
    view.unmount()
    if (timing === 'before') await act(async () => old.fail())
    await mount(action)
    if (timing === 'after') await act(async () => old.fail())
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(button(action).disabled).toBe(false)
  })

  it('old completion cannot unlock a new request after resubscription', async () => {
    const view = await mount(action)
    const old = hold(action)
    await click(button(action))
    view.unmount()
    await mount(action)
    const fresh = hold(action)
    await click(button(action))
    await act(async () => old.succeed())
    const stillPending = button(action).disabled
    await act(async () => fresh.succeed())
    expect(stillPending, 'new request is still waiting for its own reply').toBe(true)
    expect(b.update[action]).toHaveBeenCalledTimes(2)
  })
})

it('closing the notification with Escape does not install; late failure remains available on reopen', async () => {
  await mount('download')
  const pending = hold('download')
  await click(button('download', 'bell'))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  await act(async () => pending.fail())
  expect(b.update.install).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '알림 1개 보기' }))
  expect(area('bell').getByRole('alert').textContent).toContain(bellErrors.download)
})

it.each(['success', 'failure'] as const)('older check %s cannot overwrite a newer download failure', async outcome => {
  await mount()
  const old = hold('check')
  await click(button('check'))
  b.update.download.mockResolvedValueOnce(failure)
  await click(button('download'))
  expect(area('settings').getByRole('alert').textContent).toContain(errors.download)
  await act(async () => outcome === 'success' ? old.succeed() : old.fail())
  expect(area('settings').queryByRole('alert')?.textContent).toContain(errors.download)
})

it('older check failure cannot resurrect an error after a newer download success', async () => {
  await mount()
  const old = hold('check')
  await click(button('check'))
  await click(button('download'))
  await act(async () => old.fail())
  expect(screen.queryAllByRole('alert')).toHaveLength(0)
})

it('late action snapshot cannot replace newer pushed ready state', async () => {
  await mount()
  const old = deferred<IpcResult<UpdateState>>()
  b.update.download.mockImplementationOnce(() => old.promise)
  await click(button('download'))
  act(() => b.emitUpdate(ready))
  await act(async () => old.resolve({ ok: true, data: available }))
  expect(area('settings').queryByRole('button', { name: labels.install })).not.toBeNull()
  expect(area('settings').queryByRole('button', { name: labels.download })).toBeNull()
})

it('late initial read cannot replace a pushed update state', async () => {
  const old = deferred<IpcResult<UpdateState>>()
  b.update.state.mockImplementationOnce(() => old.promise)
  render(createElement(UpdateSection))
  act(() => b.emitUpdate(ready))
  await act(async () => old.resolve({ ok: true, data: available }))
  expect(button('install')).toBeTruthy()
  expect(area('settings').queryByRole('button', { name: labels.download })).toBeNull()
})

// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
import { createElement, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBackend } from '../renderer/backend'
import { useSetting } from '../../src/renderer/settings/useSetting'
import type { IpcResult } from '../../src/shared/ipc'
import type { SettingsMap } from '../../src/shared/settings/schema'

// verify is included in the node TS project (without JSX). Load the actual
// screens at runtime, while keeping this verifier itself plain TypeScript.
let SettingsScreen: ComponentType
let HomeScreen: ComponentType<{ arranging: boolean; onDoneArranging: () => void; onNavigate: () => void }>
let App: ComponentType
beforeAll(async () => {
  const settingsPath = '../../src/renderer/settings/SettingsScreen'
  const homePath = '../../src/renderer/home/HomeScreen'
  const appPath = '../../src/renderer/App'
  SettingsScreen = (await import(settingsPath)).SettingsScreen
  HomeScreen = (await import(homePath)).HomeScreen
  App = (await import(appPath)).App
})

let backend: ReturnType<typeof installBackend>
const failure = { ok: false, error: { code: 'db_unavailable' } } as const
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  backend = installBackend()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network is forbidden') }))
})
afterEach(() => {
  cleanup()
  backend.t.db.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function pie() {
  render(createElement(SettingsScreen))
  return await screen.findByRole<HTMLSelectElement>('combobox', { name: /1번/ })
}
function choose(select: HTMLSelectElement, value: string) {
  fireEvent.change(select, { target: { value } })
}

describe('P4 criterion 1: visible failure and recovery', () => {
  it.each(['response', 'exception'] as const)('pie %s failure is visible and retry survives remount', async (mode) => {
    const select = await pie()
    const before = backend.settingsRepo.get('pie.slots')
    if (mode === 'response') backend.settings.set.mockResolvedValueOnce(failure)
    else backend.settings.set.mockRejectedValueOnce(new Error('test transport failure'))
    choose(select, 'memo:quickAdd')
    expect((await screen.findByRole('alert')).textContent).toContain('저장하지 못')
    expect(select.value).toBe('memo:quickAdd')
    expect(backend.settingsRepo.get('pie.slots')).toEqual(before)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(backend.settingsRepo.get('pie.slots')[0]).toBe('memo:quickAdd')
    cleanup()
    expect((await pie()).value).toBe('memo:quickAdd')
    expect(backend.settings.set).toHaveBeenCalledTimes(2)
  })

  it('home layout failure is visible and retry stores the displayed ratio', async () => {
    render(createElement(HomeScreen, { arranging: true, onDoneArranging: () => {}, onNavigate: () => {} }))
    const separator = (await screen.findAllByRole('separator')).find((node) => node.getAttribute('aria-orientation') === 'vertical')!
    const before = backend.settingsRepo.get('home.layout')
    backend.settings.set.mockResolvedValueOnce(failure)
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    await screen.findByRole('alert')
    expect(backend.settingsRepo.get('home.layout')).toEqual(before)
    const attempted = backend.settings.set.mock.calls.at(-1)![1]
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(backend.settingsRepo.get('home.layout')).toEqual(attempted)
  })

  it('slow retry does not send the same pending save twice', async () => {
    const select = await pie()
    backend.settings.set.mockResolvedValueOnce(failure)
    choose(select, 'memo:quickAdd')
    await screen.findByRole('alert')
    const pending = deferred<IpcResult<SettingsMap['pie.slots']>>()
    backend.settings.set.mockImplementation(() => pending.promise)
    const retry = screen.getByRole('button', { name: '다시 시도' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    const calls = backend.settings.set.mock.calls.length
    await act(async () => pending.resolve({ ok: true, data: backend.settings.set.mock.calls[1][1] as SettingsMap['pie.slots'] }))
    expect(calls).toBe(2) // one failed original + one pending retry
  })

  it.each(['response', 'exception'] as const)('nav %s failure restores the saved state and a new toggle saves', async (mode) => {
    backend.settingsRepo.set('nav.collapsed', false)
    render(createElement(App))
    const toggle = await screen.findByRole('button', { name: '메뉴 접기' })
    if (mode === 'response') backend.settings.set.mockResolvedValueOnce(failure)
    else backend.settings.set.mockRejectedValueOnce(new Error('test failure'))
    fireEvent.click(toggle)
    await screen.findByRole('button', { name: '메뉴 접기' })
    expect(backend.settingsRepo.get('nav.collapsed')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '메뉴 접기' }))
    await screen.findByRole('button', { name: '메뉴 펼치기' })
    await waitFor(() => expect(backend.settingsRepo.get('nav.collapsed')).toBe(true))
  })
})

describe('P4 criterion 2: latest selection wins', () => {
  it.each(['success', 'failure', 'exception'] as const)('late first %s cannot overwrite second successful selection', async (outcome) => {
    const select = await pie()
    const old = deferred<IpcResult<SettingsMap['pie.slots']>>()
    backend.settings.set.mockImplementationOnce(() => old.promise)
    choose(select, 'memo:quickAdd')
    const first = backend.settings.set.mock.calls[0][1] as SettingsMap['pie.slots']
    choose(select, 'calendar:local')
    await waitFor(() => expect(backend.settingsRepo.get('pie.slots')[0]).toBe('calendar:local'))
    await act(async () => {
      if (outcome === 'exception') old.reject(new Error('late rejection'))
      else old.resolve(outcome === 'failure' ? failure : { ok: true, data: first })
    })
    expect(select.value).toBe('calendar:local')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('late first success cannot hide second failure; retry saves second selection', async () => {
    const select = await pie()
    const old = deferred<IpcResult<SettingsMap['pie.slots']>>()
    backend.settings.set.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(failure)
    choose(select, 'memo:quickAdd')
    const first = backend.settings.set.mock.calls[0][1] as SettingsMap['pie.slots']
    choose(select, 'calendar:local')
    await screen.findByRole('alert')
    await act(async () => old.resolve({ ok: true, data: first }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(select.value).toBe('calendar:local')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(backend.settingsRepo.get('pie.slots')[0]).toBe('calendar:local')
  })

  it('nav overlapping success then failure rolls back to the actual saved value', async () => {
    backend.settingsRepo.set('nav.collapsed', false)
    const { result } = renderHook(() => useSetting('nav.collapsed', { revertOnFailure: true }))
    await waitFor(() => expect(result.current.value).toBe(false))
    const first = deferred<IpcResult<boolean>>()
    const second = deferred<IpcResult<boolean>>()
    backend.settings.set.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    act(() => { result.current.setLocal(true); result.current.persist(true) })
    act(() => { result.current.setLocal(false); result.current.persist(false) })
    // The first write reaches storage while the second request is pending.
    backend.settingsRepo.set('nav.collapsed', true)
    await act(async () => first.resolve({ ok: true, data: true }))
    await act(async () => second.resolve(failure))
    expect(result.current.value).toBe(backend.settingsRepo.get('nav.collapsed'))
  })
})

describe('P4 criterion 3: normal flow and leaving the screen', () => {
  it('successful pie changes and reset persist across remount', async () => {
    const select = await pie()
    const defaults = backend.settingsRepo.get('pie.slots')
    choose(select, 'memo:quickAdd')
    await waitFor(() => expect(backend.settingsRepo.get('pie.slots')[0]).toBe('memo:quickAdd'))
    fireEvent.click(screen.getByRole('button', { name: '기본값으로' }))
    await waitFor(() => expect(backend.settingsRepo.get('pie.slots')).toEqual(defaults))
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    expect((await pie()).value).toBe(defaults[0])
  })

  it('leaving during a slow save cancels delivery of its late failure to the new screen', async () => {
    const select = await pie()
    const pending = deferred<IpcResult<SettingsMap['pie.slots']>>()
    backend.settings.set.mockImplementationOnce(() => pending.promise)
    choose(select, 'memo:quickAdd')
    cleanup() // cancel this screen's lifecycle, not the backend write
    const next = await pie()
    choose(next, 'calendar:local')
    await waitFor(() => expect(backend.settingsRepo.get('pie.slots')[0]).toBe('calendar:local'))
    await act(async () => pending.resolve(failure))
    expect(next.value).toBe('calendar:local')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(backend.settings.set).toHaveBeenCalledTimes(2)
  })
})

describe('P4 second verification: rollback and pending retry regressions', () => {
  it('nav late first success after second failure restores the confirmed stored value', async () => {
    backend.settingsRepo.set('nav.collapsed', false)
    const { result } = renderHook(() => useSetting('nav.collapsed', { revertOnFailure: true }))
    await waitFor(() => expect(result.current.value).toBe(false))
    const first = deferred<IpcResult<boolean>>()
    const second = deferred<IpcResult<boolean>>()
    backend.settings.set.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    act(() => { result.current.setLocal(true); result.current.persist(true) })
    // The write succeeds, but its acknowledgement is delayed until after request 2 fails.
    backend.settingsRepo.set('nav.collapsed', true)
    act(() => { result.current.setLocal(false); result.current.persist(false) })
    await act(async () => second.resolve(failure))
    expect(result.current.saving).toBe(false)
    await act(async () => first.resolve({ ok: true, data: true }))
    expect(result.current.value).toBe(backend.settingsRepo.get('nav.collapsed'))
    expect(result.current.value).toBe(true)
    expect(result.current.saveFailed).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(backend.settings.set).toHaveBeenCalledTimes(2)
  })

  it('nav stale success cannot replace a newer confirmed value used by a later rollback', async () => {
    backend.settingsRepo.set('nav.collapsed', false)
    const { result } = renderHook(() => useSetting('nav.collapsed', { revertOnFailure: true }))
    await waitFor(() => expect(result.current.value).toBe(false))
    const first = deferred<IpcResult<boolean>>()
    backend.settings.set.mockImplementationOnce(() => first.promise)
    act(() => { result.current.setLocal(true); result.current.persist(true) })
    await act(async () => { result.current.setLocal(false); result.current.persist(false) })
    await act(async () => first.resolve({ ok: true, data: true }))
    expect(result.current.value).toBe(false)
    backend.settings.set.mockResolvedValueOnce(failure)
    await act(async () => { result.current.setLocal(true); result.current.persist(true) })
    expect(result.current.value).toBe(false)
    expect(result.current.value).toBe(backend.settingsRepo.get('nav.collapsed'))
  })

  it.each(['pie', 'home'] as const)('%s retry button stays disabled during slow retry and re-enables after failure', async (target) => {
    backend.settings.set.mockResolvedValueOnce(failure)
    if (target === 'pie') {
      choose(await pie(), 'memo:quickAdd')
    } else {
      render(createElement(HomeScreen, { arranging: true, onDoneArranging: () => {}, onNavigate: () => {} }))
      const separator = (await screen.findAllByRole('separator')).find((node) => node.getAttribute('aria-orientation') === 'vertical')!
      fireEvent.keyDown(separator, { key: 'ArrowRight' })
    }
    const retry = await screen.findByRole<HTMLButtonElement>('button', { name: '다시 시도' })
    expect(retry.disabled).toBe(false)
    const pending = deferred<IpcResult<SettingsMap['pie.slots']>>()
    backend.settings.set.mockImplementationOnce(() => pending.promise)
    fireEvent.click(retry)
    expect(retry.disabled).toBe(true)
    fireEvent.click(retry)
    fireEvent.click(retry)
    expect(backend.settings.set).toHaveBeenCalledTimes(2)
    await act(async () => pending.resolve(failure))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(retry.disabled).toBe(false)
    fireEvent.click(retry)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(backend.settings.set).toHaveBeenCalledTimes(3)
    const [key, value] = backend.settings.set.mock.calls[2]
    expect(backend.settingsRepo.get(key)).toEqual(value)
  })
})

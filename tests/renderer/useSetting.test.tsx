// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { useSetting } from '../../src/renderer/settings/useSetting'
import { installBackend, type Backend } from './backend'

const t = ko.settings

type Result = { ok: true; data: unknown } | { ok: false; error: { code: string } }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const OK: Result = { ok: true, data: null }
const FAIL: Result = { ok: false, error: { code: 'internal' } }

/** 가짜 설정 API. get 은 'saved' 를 돌려주고, set 은 테스트가 정한 응답을 순서대로 돌려준다. */
function fakeOctopus(responses: Array<Promise<Result> | Result | (() => Promise<Result>)>, loaded: unknown = 'saved') {
  const queue = [...responses]
  const set = vi.fn(() => {
    const next = queue.shift() ?? OK
    if (typeof next === 'function') return next()
    return next instanceof Promise ? next : Promise.resolve(next)
  })
  const get = vi.fn(async () => ({ ok: true as const, data: loaded }))
  window.octopus = { settings: { get, set } } as unknown as typeof window.octopus
  return { get, set }
}

describe('useSetting 저장 확인', () => {
  it('shows a failed save and retries the same value on retry', async () => {
    const fake = fakeOctopus([FAIL, OK])
    const { result } = renderHook(() => useSetting('command.model'))
    await waitFor(() => expect(result.current.value).toBe('saved'))

    act(() => {
      result.current.setLocal('next')
      result.current.persist('next')
    })
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.value).toBe('next') // 화면 값은 그대로 남는다

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
    expect(fake.set).toHaveBeenCalledTimes(2)
    expect(fake.set).toHaveBeenLastCalledWith('command.model', 'next')
  })

  it('treats a thrown save as a failure', async () => {
    fakeOctopus([() => Promise.reject(new Error('boom'))])
    const { result } = renderHook(() => useSetting('command.model'))
    await waitFor(() => expect(result.current.value).toBe('saved'))

    act(() => result.current.persist('next'))
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
  })

  it('keeps the last request result when an earlier success arrives late', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    fakeOctopus([first.promise, second.promise])
    const { result } = renderHook(() => useSetting('command.model'))
    await waitFor(() => expect(result.current.value).toBe('saved'))

    act(() => {
      result.current.persist('a')
      result.current.persist('b')
    })
    await act(async () => second.resolve(FAIL))
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    await act(async () => first.resolve(OK)) // 먼저 보낸 요청의 늦은 성공이 실패 표시를 지우면 안 된다
    expect(result.current.saveFailed).toBe(true)
  })

  it('ignores an earlier failure that arrives after a later success', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    const fake = fakeOctopus([first.promise, second.promise])
    const { result } = renderHook(() => useSetting('command.model'))
    await waitFor(() => expect(result.current.value).toBe('saved'))

    act(() => {
      result.current.persist('a')
      result.current.persist('b')
    })
    await act(async () => second.resolve(OK))
    await act(async () => first.resolve(FAIL)) // 낡은 실패는 화면 상태를 바꾸지 않는다

    expect(fake.set).toHaveBeenCalledTimes(2)
    expect(result.current.saveFailed).toBe(false)
  })

  it('reverts to the last saved value when revertOnFailure is set', async () => {
    fakeOctopus([FAIL], true)
    const { result } = renderHook(() => useSetting('nav.collapsed', { revertOnFailure: true }))
    await waitFor(() => expect(result.current.value).toBe(true))

    act(() => {
      result.current.setLocal(false)
      result.current.persist(false)
    })
    expect(result.current.value).toBe(false)
    await waitFor(() => expect(result.current.value).toBe(true))
    expect(result.current.saveFailed).toBe(false)
  })
})

const flush = (): Promise<void> => act(async () => new Promise<void>((r) => setTimeout(r, 0)))

describe('useSetting 겹친 저장과 다시 시도', () => {
  it('keeps the really stored value when the earlier save succeeds before the later failure', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    const queue: Array<Promise<Result>> = [first.promise, second.promise]
    fakeOctopus([], false)
    window.octopus.settings.set = vi.fn(() => queue.shift() ?? Promise.resolve(OK)) as never
    const { result } = renderHook(() => useSetting('nav.collapsed', { revertOnFailure: true }))
    await waitFor(() => expect(result.current.value).toBe(false))

    act(() => {
      result.current.setLocal(true)
      result.current.persist(true) // 첫 요청(true): 성공
      result.current.setLocal(false)
      result.current.persist(false) // 두 번째 요청(false): 실패
    })
    await act(async () => first.resolve(OK))
    await flush()
    await act(async () => second.resolve(FAIL))
    await flush()
    expect(result.current.value).toBe(true) // 실제로 저장된 값(true)으로 되돌린다(예전 값 false 가 아니다)
    expect(result.current.saveFailed).toBe(false)
  })

  it('ends at the stored value when the earlier success arrives after the later failure', async () => {
    const first = deferred<Result>()
    const second = deferred<Result>()
    const queue: Array<Promise<Result>> = [first.promise, second.promise]
    fakeOctopus([], false)
    window.octopus.settings.set = vi.fn(() => queue.shift() ?? Promise.resolve(OK)) as never
    const { result } = renderHook(() => useSetting('nav.collapsed', { revertOnFailure: true }))
    await waitFor(() => expect(result.current.value).toBe(false))

    act(() => {
      result.current.setLocal(true)
      result.current.persist(true) // 첫 요청(true): 저장은 되지만 응답이 늦다
      result.current.setLocal(false)
      result.current.persist(false) // 두 번째 요청(false): 실패
    })
    await act(async () => second.resolve(FAIL))
    await flush()
    expect(result.current.value).toBe(false) // 아직 첫 응답 전: 저장된 값은 false
    await act(async () => first.resolve(OK))
    await flush()
    expect(result.current.value).toBe(true) // 첫 요청이 실제로 저장한 값으로 맞춘다
    expect(result.current.saveFailed).toBe(false)
  })

  it('does not send a second retry while the first retry is pending, but allows a new save', async () => {
    const pending = deferred<Result>()
    const fake = fakeOctopus([FAIL, () => pending.promise, OK])
    const { result } = renderHook(() => useSetting('command.model'))
    await waitFor(() => expect(result.current.value).toBe('saved'))

    act(() => result.current.persist('next'))
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.saving).toBe(false)

    act(() => result.current.retry())
    expect(result.current.saving).toBe(true)
    act(() => result.current.retry())
    act(() => result.current.retry())
    expect(fake.set).toHaveBeenCalledTimes(2) // 원래 요청 + 다시 시도 1번

    act(() => result.current.persist('newer')) // 저장 중에도 새 값은 보낼 수 있다(마지막 값이 이긴다)
    expect(fake.set).toHaveBeenCalledTimes(3)
    expect(fake.set).toHaveBeenLastCalledWith('command.model', 'newer')

    pending.resolve(OK)
    await flush()
    expect(result.current.saving).toBe(false)
  })
})

describe('설정 화면의 저장 실패 안내', () => {
  let b: Backend

  afterEach(() => {
    cleanup()
    b?.t.db.close()
  })

  it('shows the message with 다시 시도 on the pie menu and saves again when retried', async () => {
    const user = userEvent.setup()
    b = installBackend('settings')
    b.settings.set.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
    render(<App />)
    const region = await screen.findByRole('region', { name: t.pieTitle })
    const slot = (): HTMLSelectElement => within(region).getAllByRole('combobox')[0] as HTMLSelectElement
    await waitFor(() => expect(slot().value).toBe('command'))

    await user.selectOptions(slot(), 'nav:tasks')

    const alert = await within(region).findByRole('alert')
    expect(alert.textContent).toContain(t.saveFailed)
    expect(slot().value).toBe('nav:tasks') // 화면 값은 그대로 둔다

    await user.click(within(alert).getByRole('button', { name: t.saveRetry }))
    await waitFor(() => expect(within(region).queryByRole('alert')).toBeNull())
    expect(b.settings.set).toHaveBeenCalledTimes(2)
    expect(b.settingsRepo.get('pie.slots')[0]).toBe('nav:tasks')
  })
})

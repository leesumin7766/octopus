// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../src/shared/ipc'
import type { UpdateState } from '../../src/shared/update/types'
import { UpdateSection } from '../../src/renderer/settings/UpdateSection'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

const u = ko.settings.update
const failure = { ok: false as const, error: { code: 'internal' as const } }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

describe('update action ordering', () => {
  let b: Backend

  beforeEach(() => {
    b = installBackend('settings')
    Object.assign(b.updateState, { status: 'available', version: '0.2.0' })
  })

  afterEach(() => {
    cleanup()
    b.t.db.close()
  })

  const section = (): HTMLElement => screen.getByRole('region', { name: u.title })

  it('a late reply from an older check cannot change a newer download failure', async () => {
    const user = userEvent.setup()
    render(<UpdateSection />)
    const old = deferred<IpcResult<UpdateState>>()
    b.update.check.mockImplementationOnce(() => old.promise)
    await user.click(await within(section()).findByRole('button', { name: u.check }))
    b.update.download.mockResolvedValueOnce(failure)
    await user.click(within(section()).getByRole('button', { name: u.download }))
    expect(await within(section()).findByRole('alert')).toBeTruthy()

    await act(async () => old.resolve(failure))
    expect(within(section()).getByRole('alert').textContent).toContain(u.failed.download)
  })

  it('a state main pushed after a request was sent is not replaced by that request\'s older answer', async () => {
    const user = userEvent.setup()
    render(<UpdateSection />)
    const old = deferred<IpcResult<UpdateState>>()
    b.update.download.mockImplementationOnce(() => old.promise)
    await user.click(await within(section()).findByRole('button', { name: u.download }))
    act(() => b.emitUpdate({ status: 'ready', current: '0.1.0', version: '0.2.0' }))

    await act(async () => old.resolve({ ok: true, data: { status: 'available', current: '0.1.0', version: '0.2.0' } }))
    expect(within(section()).getByRole('button', { name: u.install })).toBeTruthy()
    expect(within(section()).queryByRole('button', { name: u.download })).toBeNull()
  })

  it('a reply that comes back after everything was unmounted is ignored, not shown on the next mount', async () => {
    const user = userEvent.setup()
    const view = render(<UpdateSection />)
    const old = deferred<IpcResult<UpdateState>>()
    b.update.download.mockImplementationOnce(() => old.promise)
    await user.click(await within(section()).findByRole('button', { name: u.download }))
    view.unmount()

    render(<UpdateSection />)
    await within(section()).findByRole('button', { name: u.download })
    await act(async () => old.resolve(failure))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})

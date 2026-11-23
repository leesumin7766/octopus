import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstance, type SingleInstanceApp, type WindowLike } from '../src/main/singleInstance'

function fakeApp(lock: boolean) {
  const listeners: (() => void)[] = []
  const app: SingleInstanceApp = {
    requestSingleInstanceLock: vi.fn(() => lock),
    quit: vi.fn(),
    on: vi.fn((_event, listener) => void listeners.push(listener))
  }
  return { app, secondInstance: () => listeners.forEach((l) => l()) }
}

const fakeWindow = (minimized = false) => ({ isMinimized: vi.fn(() => minimized), restore: vi.fn(), show: vi.fn(), focus: vi.fn() }) satisfies WindowLike

describe('single instance', () => {
  it('the first process takes the lock and keeps running', () => {
    const { app } = fakeApp(true)
    expect(acquireSingleInstance(app, () => null, false)).toBe(true)
    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('a second process (lock refused) quits at once and does not register anything', () => {
    const { app } = fakeApp(false)
    expect(acquireSingleInstance(app, () => fakeWindow(), false)).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.on).not.toHaveBeenCalled()
  })

  it('when a second launch happens the existing window is shown and focused', () => {
    const { app, secondInstance } = fakeApp(true)
    const win = fakeWindow()
    acquireSingleInstance(app, () => win, false)

    secondInstance()

    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('a minimized window is restored first', () => {
    const { app, secondInstance } = fakeApp(true)
    const win = fakeWindow(true)
    acquireSingleInstance(app, () => win, false)
    secondInstance()
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('a second launch before the window exists does nothing (and does not throw)', () => {
    const { app, secondInstance } = fakeApp(true)
    acquireSingleInstance(app, () => null, false)
    expect(() => secondInstance()).not.toThrow()
  })

  it('the development capture is exempt: it never asks for the lock', () => {
    const { app } = fakeApp(false)
    expect(acquireSingleInstance(app, () => null, true)).toBe(true)
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
  })
})

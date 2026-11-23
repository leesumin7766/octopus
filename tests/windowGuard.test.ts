import { describe, expect, it, vi } from 'vitest'
import { guardWindow, isAppNavigation, type GuardableWebContents, type GuardOptions } from '../src/main/windowGuard'

const indexFilePath = process.platform === 'win32' ? 'C:\\app\\resources\\app.asar\\out\\renderer\\index.html' : '/app/resources/app.asar/out/renderer/index.html'
const dev = { devUrl: 'http://localhost:5173/', indexFilePath }
const prod = { indexFilePath }

describe('isAppNavigation', () => {
  it('allows the dev server origin (any path, query, hash) only while a dev server is configured', () => {
    for (const url of ['http://localhost:5173/', 'http://localhost:5173/index.html', 'http://localhost:5173/#/x?y=1']) expect(isAppNavigation(url, dev), url).toBe(true)
    expect(isAppNavigation('http://localhost:5173/', prod)).toBe(false)
  })

  it('refuses other origins, ports and schemes, including look-alike hosts', () => {
    for (const url of ['http://localhost:5174/', 'https://localhost:5173/', 'http://localhost.evil.com:5173/', 'http://evil.com/', 'https://example.com/', 'ftp://localhost:5173/', 'javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'about:blank', 'obsidian://open?vault=x', '', 'not a url']) {
      expect(isAppNavigation(url, dev), url).toBe(false)
    }
  })

  it("allows the app's own index.html (with hash or query) and nothing else on disk", () => {
    const index = process.platform === 'win32' ? 'file:///C:/app/resources/app.asar/out/renderer/index.html' : 'file:///app/resources/app.asar/out/renderer/index.html'
    expect(isAppNavigation(index, prod)).toBe(true)
    expect(isAppNavigation(`${index}#home`, prod)).toBe(true)
    expect(isAppNavigation(`${index}?x=1`, prod)).toBe(true)
    expect(isAppNavigation(index.replace('index.html', 'other.html'), prod)).toBe(false)
    expect(isAppNavigation('file:///etc/passwd', prod)).toBe(false)
    expect(isAppNavigation('file:///C:/Windows/System32/calc.exe', prod)).toBe(false)
    expect(isAppNavigation(index.replace('/renderer/', '/renderer/../main/'), prod)).toBe(false)
  })
})

describe('guardWindow', () => {
  function setup(options: GuardOptions = dev) {
    const listeners: Record<string, (e: { preventDefault(): void; url: string }) => void> = {}
    let openHandler: (() => { action: string }) | undefined
    const contents: GuardableWebContents = {
      setWindowOpenHandler: (h) => void (openHandler = h),
      on: (event, listener) => void (listeners[event] = listener)
    }
    guardWindow(contents, options)
    const navigate = (event: 'will-navigate' | 'will-redirect', url: string): boolean => {
      const e = { preventDefault: vi.fn(), url }
      listeners[event](e)
      return e.preventDefault.mock.calls.length > 0
    }
    return { navigate, open: () => openHandler?.() }
  }

  it('every new window request is denied', () => {
    expect(setup().open()).toEqual({ action: 'deny' })
    expect(setup(prod).open()).toEqual({ action: 'deny' })
  })

  it('navigation outside the app is prevented, navigation inside it is left alone (also for redirects)', () => {
    const g = setup()
    expect(g.navigate('will-navigate', 'https://example.com/')).toBe(true)
    expect(g.navigate('will-redirect', 'https://example.com/')).toBe(true)
    expect(g.navigate('will-navigate', 'file:///etc/passwd')).toBe(true)
    expect(g.navigate('will-navigate', 'http://localhost:5173/#/x')).toBe(false)
    expect(g.navigate('will-redirect', 'http://localhost:5173/')).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { FORBIDDEN_RESULT, guardIpc, isTrustedSender } from '../../src/main/ipc/senderCheck'
import type { IpcMainLike } from '../../src/main/ipc/result'

const indexFilePath = process.platform === 'win32' ? 'C:\\app\\resources\\app.asar\\out\\renderer\\index.html' : '/app/resources/app.asar/out/renderer/index.html'
const indexUrl = process.platform === 'win32' ? 'file:///C:/app/resources/app.asar/out/renderer/index.html' : 'file:///app/resources/app.asar/out/renderer/index.html'
const dev = { devUrl: 'http://localhost:5173/', indexFilePath }
const prod = { indexFilePath }
const from = (url: string, parent: unknown = null) => ({ senderFrame: { url, parent } })

describe('isTrustedSender', () => {
  it('trusts the dev server page (in development) and the app index.html (packaged), including hash/query', () => {
    expect(isTrustedSender(from('http://localhost:5173/'), dev)).toBe(true)
    expect(isTrustedSender(from('http://localhost:5173/#/x'), dev)).toBe(true)
    expect(isTrustedSender(from(indexUrl), prod)).toBe(true)
    expect(isTrustedSender(from(`${indexUrl}#home`), prod)).toBe(true)
  })

  it('refuses any other address, a dev address in a packaged app, and other local files', () => {
    for (const url of ['https://example.com/', 'http://localhost:5174/', 'http://localhost.evil.com:5173/', 'file:///etc/passwd', 'about:blank', 'data:text/html,x', '']) {
      expect(isTrustedSender(from(url), dev), url).toBe(false)
    }
    expect(isTrustedSender(from('http://localhost:5173/'), prod)).toBe(false)
  })

  it('refuses sub-frames, and requests whose sender frame is unknown (destroyed frame, missing event)', () => {
    expect(isTrustedSender(from(indexUrl, { url: 'parent' }), prod)).toBe(false)
    for (const bad of [{ senderFrame: null }, {}, null, undefined, 'x', { senderFrame: { url: 5 } }]) expect(isTrustedSender(bad, prod), JSON.stringify(bad)).toBe(false)
  })
})

describe('guardIpc', () => {
  function setup(options = prod) {
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const base: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }
    const denied = vi.fn()
    const guarded = guardIpc(base, options, denied)
    return { guarded, registered, denied }
  }

  it('registers every channel under its own name and calls the handler (with its arguments and its result) for the app page', async () => {
    const { guarded, registered, denied } = setup()
    const handler = vi.fn(async (_e: unknown, a: unknown, b: unknown) => ({ ok: true, data: [a, b] }))
    guarded.handle('tasks:list', handler)
    guarded.handle('app:version', () => '0.1.0')

    expect([...registered.keys()]).toEqual(['tasks:list', 'app:version'])
    expect(await registered.get('tasks:list')?.(from(indexUrl), 1, 2)).toEqual({ ok: true, data: [1, 2] })
    expect(registered.get('app:version')?.(from(indexUrl))).toBe('0.1.0')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(denied).not.toHaveBeenCalled()
  })

  it('does NOT run the handler for an untrusted sender: it answers { ok:false, error:{ code:"forbidden" } } and reports it', () => {
    const { guarded, registered, denied } = setup()
    const handler = vi.fn(() => ({ ok: true, data: 'secret' }))
    guarded.handle('settings:get', handler)

    const result = registered.get('settings:get')?.(from('https://evil.example/page'), 'api.key')

    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } })
    expect(result).toBe(FORBIDDEN_RESULT)
    expect(handler).not.toHaveBeenCalled()
    expect(denied).toHaveBeenCalledWith('settings:get', 'https://evil.example/page')
  })

  it('a channel listed as non-result (throwChannels) throws Error("forbidden") instead of returning a result object', () => {
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const base: IpcMainLike = { handle: (channel, listener) => void registered.set(channel, listener) }
    const denied = vi.fn()
    const guarded = guardIpc(base, prod, denied, new Set(['app:version']))
    const handler = vi.fn(() => '0.1.0')
    guarded.handle('app:version', handler)

    expect(registered.get('app:version')?.(from(indexUrl))).toBe('0.1.0')
    expect(() => registered.get('app:version')?.(from('https://evil.example/'))).toThrow('forbidden')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(denied).toHaveBeenCalledWith('app:version', 'https://evil.example/')
  })

  it('an event without a frame is denied too (and reported with no address)', () => {
    const { guarded, registered, denied } = setup()
    const handler = vi.fn()
    guarded.handle('x', handler)
    expect(registered.get('x')?.({})).toEqual(FORBIDDEN_RESULT)
    expect(handler).not.toHaveBeenCalled()
    expect(denied).toHaveBeenCalledWith('x', null)
  })
})

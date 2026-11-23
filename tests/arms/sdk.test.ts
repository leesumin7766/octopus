import { describe, expect, it, vi } from 'vitest'
import { createArmContext, type LogEntry } from '../../src/main/arms/sdk/context'
import { createHttp, type HttpFetch } from '../../src/main/arms/sdk/http'
import { validateManifest } from '../../src/main/arms/sdk/manifest'
import { ArmHttpError } from '../../src/main/arms/sdk/types'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import { redactString, redactValue } from '../../src/shared/redact'
import { manifest } from './helpers'

describe('manifest validation', () => {
  it('accepts a complete manifest and an oauth one with scopes', () => {
    expect(validateManifest(manifest()).ok).toBe(true)
    expect(validateManifest(manifest({ id: 'google-calendar', auth: 'oauth', scopes: ['calendar.readonly'], capabilities: ['events.read', 'links'], syncIntervalMinutes: 30 })).ok).toBe(true)
  })

  it.each<[string, Partial<import('../../src/shared/arms/types').ArmManifest>]>([
    ['upper-case id', { id: 'Google' }],
    ['id with a space', { id: 'a b' }],
    ['id with an underscore', { id: 'a_b' }],
    ['empty id', { id: '' }],
    ['id starting with a hyphen', { id: '-a' }],
    ['empty name', { name: ' ' }],
    ['unknown auth', { auth: 'password' as never }],
    ['unknown capability', { capabilities: ['tasks.import', 'root.access' as never] }],
    ['repeated capability', { capabilities: ['links', 'links'] }],
    ['capabilities not a list', { capabilities: 'links' as never }],
    ['scopes with a non-string', { scopes: ['a', 5 as never] }],
    ['oauth without scopes', { auth: 'oauth' as const }],
    ['sync interval 0', { syncIntervalMinutes: 0 }],
    ['sync interval not a number', { syncIntervalMinutes: '15' as never }]
  ])('refuses %s', (_name, over) => {
    const result = validateManifest(manifest(over))
    expect(result.ok).toBe(false)
  })

  it('refuses things that are not objects, and never echoes values back', () => {
    for (const bad of [null, 'x', 5, [], undefined]) expect(validateManifest(bad).ok).toBe(false)
    const result = validateManifest(manifest({ id: 'SECRET-VALUE' }))
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE')
  })
})

describe('redaction', () => {
  it('hides bearer headers, key-looking strings, JWTs, secret query values and known secrets', () => {
    const text = 'Authorization: Bearer abc.def-123456 sk-ant-ABCDEFGH123456 url=https://x.test/cb?code=XYZ123&token=ttt&ok=1 mine=hunter2hunter2'
    const out = redactString(text, ['hunter2hunter2'])
    expect(out).not.toMatch(/abc\.def|ABCDEFGH|XYZ123|ttt|hunter2/)
    expect(out).toContain('ok=1')
    expect(redactString('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig')).not.toContain('eyJhbGci')
    expect(redactString('a'.repeat(20) + '1' + 'b'.repeat(20))).not.toContain('bbbbbbbb')
  })

  it('hides values under secret-looking field names, at any depth, and keeps the rest', () => {
    const out = redactValue({ user: 'kim', Authorization: 'Bearer zzz', nested: { access_token: 'AAA', apiKey: 'BBB', refresh_token: 'CCC', password: 'DDD', note: '안녕' }, list: [{ secret: 'EEE' }] }) as Record<string, any>
    const json = JSON.stringify(out)
    expect(json).not.toMatch(/zzz|AAA|BBB|CCC|DDD|EEE/)
    expect(out.user).toBe('kim')
    expect(out.nested.note).toBe('안녕')
  })

  it('an Error is logged as name and redacted message only (no stack)', () => {
    const out = redactValue(new Error('failed with Bearer abcdefghij')) as { name: string; message: string }
    expect(Object.keys(out).sort()).toEqual(['message', 'name'])
    expect(out.message).not.toContain('abcdefghij')
  })
})

describe('ArmContext', () => {
  const make = (armId: string, store = createMemorySecureStore()) => {
    const entries: LogEntry[] = []
    const added: unknown[] = []
    const ctx = createArmContext({
      armId,
      interactive: true,
      secureStore: store,
      http: { fetch: vi.fn() as never },
      logSink: (e) => void entries.push(e),
      core: { addInboxCandidate: (c) => (added.push(c), { added: true, accepted: false }), listTasks: () => [], onTasksChanged: () => () => {} }
    })
    return { ctx, entries, store, added }
  }

  it('secrets live in the namespace arm:<id> and one arm cannot see another one', () => {
    const store = createMemorySecureStore()
    const a = make('arm-a', store).ctx
    const b = make('arm-b', store).ctx
    a.secrets.set('token', 'A-TOKEN')
    b.secrets.set('token', 'B-TOKEN')

    expect(store.get('arm:arm-a', 'token')).toBe('A-TOKEN')
    expect(a.secrets.get('token')).toBe('A-TOKEN')
    expect(b.secrets.get('token')).toBe('B-TOKEN')
    // 이름에 이름공간 구분자를 넣어도 다른 Arm 의 것을 읽을 수 없다.
    expect(a.secrets.get('arm:arm-b:token')).toBeUndefined()
    expect(store.get('arm:arm-b', 'arm-a')).toBeUndefined()

    a.secrets.delete('token')
    expect(a.secrets.get('token')).toBeUndefined()
    expect(b.secrets.get('token')).toBe('B-TOKEN')
  })

  it('the log hides secrets this arm stored or read, plus token-like fields, before they reach the sink', () => {
    const { ctx, entries, store } = make('arm-a')
    ctx.secrets.set('refresh', 'my-refresh-value-123')
    store.set('arm:arm-a', 'other', 'another-stored-secret')
    ctx.secrets.get('other')

    ctx.log.info('got my-refresh-value-123 and another-stored-secret', { Authorization: 'Bearer abcdefghij', access_token: 'tok', ok: 'fine' })
    ctx.log.error('boom', new Error('Bearer qwertyuiop'))

    const all = JSON.stringify(entries)
    expect(all).not.toMatch(/my-refresh-value|another-stored|abcdefghij|"tok"|qwertyuiop/)
    expect(all).toContain('fine')
    expect(entries.map((e) => [e.level, e.armId])).toEqual([['info', 'arm-a'], ['error', 'arm-a']])
  })

  it('core: the candidate source is the arm the context was built for, and there is no write access to tasks', () => {
    const { ctx } = make('arm-a')
    expect(Object.keys(ctx.core).sort()).toEqual(['addInboxCandidate', 'listTasks', 'onTasksChanged'])
    expect(ctx.interactive).toBe(true)
  })
})

describe('ArmContext.http', () => {
  const response = (status: number, body = '{"ok":true}', headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null, forEach: (cb: (v: string, k: string) => void) => Object.entries(headers).forEach(([k, v]) => cb(v, k)) },
    text: async () => body
  })
  const sleeps: number[] = []
  const http = (fetch: HttpFetch) => createHttp({ fetch, sleep: async (ms) => void sleeps.push(ms) })

  it('returns status and parsed json; 4xx is returned, not thrown, and not retried', async () => {
    const fetch = vi.fn<HttpFetch>(async () => response(404, '{"error":"nope"}'))
    const r = await http(fetch).request('https://x.test/a')
    expect(r.status).toBe(404)
    expect(r.ok).toBe(false)
    expect(r.json()).toEqual({ error: 'nope' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries 429 and 5xx twice with growing waits, then returns the last response', async () => {
    sleeps.length = 0
    const fetch = vi.fn<HttpFetch>(async () => response(503, 'down'))
    const r = await http(fetch).request('https://x.test/a')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([500, 1000])
    expect(r.status).toBe(503)
  })

  it('a retry that succeeds ends the loop', async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(response(429)).mockResolvedValueOnce(response(200, '{"a":1}'))
    const r = await http(fetch).request('https://x.test/a')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(r.json()).toEqual({ a: 1 })
  })

  it('a network error is retried, then thrown as ArmHttpError without the address in the message', async () => {
    const fetch = vi.fn<HttpFetch>(async () => {
      throw new Error('getaddrinfo ENOTFOUND secret.internal.example')
    })
    const error = await http(fetch).request('https://secret.internal.example/x?token=abc').catch((e: unknown) => e)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(error).toBeInstanceOf(ArmHttpError)
    expect((error as ArmHttpError).kind).toBe('network')
    expect((error as Error).message).not.toMatch(/secret|abc/)
  })

  it('times out each attempt (default 15 s) and reports a timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn<HttpFetch>(() => new Promise(() => {})) // 끝나지 않는 요청
      const pending = createHttp({ fetch, sleep: async () => {} }).request('https://x.test/a', { retries: 0 }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(14_999)
      expect(fetch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2)
      const error = (await pending) as ArmHttpError
      expect(error).toBeInstanceOf(ArmHttpError)
      expect(error.kind).toBe('timeout')
      expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a custom timeout is honoured', async () => {
    vi.useFakeTimers()
    try {
      const pending = createHttp({ fetch: () => new Promise(() => {}), sleep: async () => {} }).request('https://x.test/a', { retries: 0, timeoutMs: 100 }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(101)
      expect(((await pending) as ArmHttpError).kind).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a response over the size limit (declared or actual) and does not retry it', async () => {
    const declared = vi.fn<HttpFetch>(async () => response(200, 'x', { 'content-length': '999999' }))
    const e1 = await http(declared).request('https://x.test/a', { maxBytes: 1000 }).catch((e: unknown) => e)
    expect((e1 as ArmHttpError).kind).toBe('too_large')
    expect(declared).toHaveBeenCalledTimes(1)

    const actual = vi.fn<HttpFetch>(async () => response(200, 'y'.repeat(2000)))
    const e2 = await http(actual).request('https://x.test/a', { maxBytes: 1000 }).catch((e: unknown) => e)
    expect((e2 as ArmHttpError).kind).toBe('too_large')
  })

  it('bad JSON is an ArmHttpError(bad_json) only when the arm asks for json()', async () => {
    const r = await http(async () => response(200, '<html>')).request('https://x.test/a')
    expect(r.text).toBe('<html>')
    expect(() => r.json()).toThrow(ArmHttpError)
  })

  it('passes method, headers and body through', async () => {
    const fetch = vi.fn<HttpFetch>(async () => response(200))
    await http(fetch).request('https://x.test/a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
  })
})

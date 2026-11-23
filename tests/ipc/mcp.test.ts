import { describe, expect, it, vi } from 'vitest'
import { createMcpService, type McpService } from '../../src/main/arms/mcp/service'
import type { McpConnection } from '../../src/main/arms/mcp/connection'
import { createMcpHandlers, registerMcpHandlers } from '../../src/main/ipc/mcp'
import { IPC } from '../../src/shared/ipc'
import type { McpServerConfig } from '../../src/shared/mcp/types'
import { createManagerEnv } from '../arms/helpers'

const connection = (): McpConnection => ({
  tools: () => [{ name: 'a', description: 'd', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
  callTool: async () => ({ content: [] }),
  close: async () => {},
  pid: () => null
})

function setup(opts: { noService?: boolean } = {}) {
  const env = createManagerEnv()
  const servers: McpServerConfig[] = []
  let n = 0
  const service: McpService = createMcpService({
    manager: env.manager,
    settings: { getServers: () => servers, setServers: (s) => void servers.splice(0, servers.length, ...s), getApprovals: () => [], setApprovals: () => {} },
    secureStore: env.store,
    connector: async () => connection(),
    confirmRun: async () => true,
    newUlid: () => `XXXXXXXXXXXXXXXXXX${String(10_000_000 + n++)}`
  })
  const logged: unknown[] = []
  const handlers = createMcpHandlers({ getService: () => (opts.noService ? null : service), logError: (_c, e) => void logged.push(e) })
  return { handlers, env, servers }
}

describe('mcp IPC handlers', () => {
  it('add → list → reconnect → remove; the answers never contain environment values', async () => {
    const { handlers, env, servers } = setup()
    const added = await handlers.add({ name: '노트', transport: 'stdio', command: 'tool', args: ['--x'], env: [{ name: 'API_TOKEN', value: 'secret-value-999' }] })
    if (!added.ok) throw new Error('add failed')

    expect(added.data).toMatchObject({ name: '노트', transport: 'stdio', target: 'tool --x', envKeys: ['API_TOKEN'], status: { state: 'on' }, tools: [{ name: expect.stringMatching(/__a$/), readOnly: true }] })
    expect(added.data.id).toMatch(/^mcp-[a-z0-9]+$/)
    const everything = JSON.stringify([added, handlers.list(), await handlers.reconnect(added.data.id), servers, env.logs])
    expect(everything).not.toContain('secret-value-999')
    expect(env.store.get(`arm:${added.data.id}`, 'env')).toContain('secret-value-999')

    expect(handlers.list()).toMatchObject({ ok: true, data: [{ id: added.data.id }] })
    expect(await handlers.remove(added.data.id)).toEqual({ ok: true, data: null })
    expect(handlers.list()).toEqual({ ok: true, data: [] })
    expect(env.store.get(`arm:${added.data.id}`, 'env')).toBeUndefined()
  })

  it('validates every input; nothing is saved or run when it is wrong', async () => {
    const { handlers, servers } = setup()
    expect(await handlers.add({ name: 'x', transport: 'http', url: 'http://example.com/mcp' })).toEqual({ ok: false, error: { code: 'invalid_input', fields: ['url'] } })
    expect(await handlers.add({ name: 'x', transport: 'stdio', command: '' })).toMatchObject({ ok: false, error: { fields: ['command'] } })
    expect(await handlers.add('rm -rf /')).toMatchObject({ ok: false })
    expect(servers).toEqual([])
    expect(await handlers.remove('../x')).toMatchObject({ ok: false, error: { fields: ['id'] } })
    expect(await handlers.reconnect(5)).toMatchObject({ ok: false })
  })

  it('unknown servers are not_found; without a database every channel says db_unavailable', async () => {
    const { handlers } = setup()
    expect(await handlers.remove('mcp-aaaa1111')).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await handlers.reconnect('mcp-aaaa1111')).toEqual({ ok: false, error: { code: 'not_found' } })

    const none = setup({ noService: true }).handlers
    expect(none.list()).toEqual({ ok: false, error: { code: 'db_unavailable' } })
    expect(await none.add({ name: 'x', transport: 'http', url: 'https://x.test/mcp' })).toEqual({ ok: false, error: { code: 'db_unavailable' } })
  })

  it('registers exactly the four mcp channels', () => {
    const handle = vi.fn()
    registerMcpHandlers({ handle }, setup().handlers)
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual([IPC.mcpList, IPC.mcpAdd, IPC.mcpRemove, IPC.mcpReconnect].sort())
  })
})

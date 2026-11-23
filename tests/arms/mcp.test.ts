import { describe, expect, it, vi } from 'vitest'
import { commandFingerprint, renderContent, MESSAGES } from '../../src/main/arms/mcp/arm'
import { prefixedToolNames } from '../../src/main/arms/mcp/naming'
import { commandLine } from '../../src/main/arms/mcp/service'
import { createCommandConfirm, describeCommand } from '../../src/main/platform/commandConfirm'
import { normalizeMcpServers, parseMcpAddInput, parseMcpApprovals, parseMcpServers, isAllowedMcpUrl } from '../../src/shared/validation/mcp'
import { defaultSetting, parseSetting, readSetting } from '../../src/shared/settings/schema'

describe('tool names', () => {
  it('"<서버>__<도구>", only [a-zA-Z0-9_-], at most 64 characters', () => {
    expect(prefixedToolNames('Notes', 'mcp-aaaa1111', ['search', 'create page', 'a/b.c'])).toEqual(['Notes__search', 'Notes__create_page', 'Notes__a_b_c'])
    const long = prefixedToolNames('x'.repeat(100), 'mcp-aaaa1111', ['y'.repeat(100)])[0]
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  })

  it('a server name without any letters or digits (e.g. Korean) falls back to the server id', () => {
    expect(prefixedToolNames('노션', 'mcp-abcd1234', ['search'])).toEqual(['mcp-abcd1234__search'])
    expect(prefixedToolNames('!!!', 'mcp-abcd1234', ['t'])).toEqual(['mcp-abcd1234__t'])
  })

  it('names that collide after cleaning get _2, _3 …, and everything stays unique', () => {
    const names = prefixedToolNames('S', 'mcp-aaaa1111', ['a b', 'a_b', 'a-b?', 'a b', 'a b'])
    expect(new Set(names).size).toBe(names.length)
    expect(names.slice(0, 2)).toEqual(['S__a_b', 'S__a_b_2'])
    for (const n of prefixedToolNames('S'.repeat(30), 'mcp-aaaa1111', Array(5).fill('z'.repeat(80)))) expect(n.length).toBeLessThanOrEqual(64)
  })

  it('an empty tool name still yields a usable name', () => {
    expect(prefixedToolNames('S', 'mcp-aaaa1111', ['', '???'])).toEqual(['S__tool', 'S__tool_2'])
  })
})

describe('result rendering', () => {
  it('uses text only; everything else is "[지원하지 않는 내용]"', () => {
    expect(renderContent([{ type: 'text', text: 'A' }, { type: 'image', data: 'x' }, { type: 'resource', resource: {} }, 'raw', null, { type: 'text', text: 'B' }])).toBe(
      `A\n${MESSAGES.unsupportedContent}\n${MESSAGES.unsupportedContent}\n${MESSAGES.unsupportedContent}\n${MESSAGES.unsupportedContent}\nB`
    )
    expect(renderContent([])).toBe('')
  })
})

describe('command fingerprint', () => {
  it('changes when the command or any argument changes, in order, and is stable otherwise', () => {
    const a = commandFingerprint('npx', ['-y', 'pkg'])
    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(commandFingerprint('npx', ['-y', 'pkg'])).toBe(a)
    expect(commandFingerprint('npx', ['-y', 'pkg2'])).not.toBe(a)
    expect(commandFingerprint('npx', ['pkg', '-y'])).not.toBe(a)
    expect(commandFingerprint('npx2', ['-y', 'pkg'])).not.toBe(a)
    expect(commandFingerprint('npx', ['-y pkg'])).not.toBe(a) // 공백으로 이어 붙인 것과 다르다
    expect(commandFingerprint('npx', ['-y', 'pkg', ''])).not.toBe(a)
  })
})

describe('URL rule', () => {
  it.each([
    ['https://mcp.example.com/mcp', true],
    ['https://example.com:8443/x?y=1', true],
    ['http://localhost:3000/mcp', true],
    ['http://127.0.0.1:3000/mcp', true],
    ['http://[::1]:3000/mcp', true],
    ['http://example.com/mcp', false],
    ['http://192.168.0.5/mcp', false],
    ['http://localhost.evil.com/mcp', false],
    ['http://127.0.0.1.evil.com/mcp', false],
    ['http://user:pw@localhost/mcp', false],
    ['https://user:pw@example.com/mcp', false],
    ['ftp://example.com', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['', false],
    ['not a url', false]
  ])('%s → %s', (url, ok) => {
    expect(isAllowedMcpUrl(url)).toBe(ok)
  })
})

describe('add input validation', () => {
  it('accepts a localhost/https http server and a stdio command with args and env', () => {
    expect(parseMcpAddInput({ name: ' 노트 ', transport: 'http', url: 'https://x.example.com/mcp' })).toEqual({ ok: true, value: { name: '노트', transport: 'http', url: 'https://x.example.com/mcp' } })
    const stdio = parseMcpAddInput({ name: 's', transport: 'stdio', command: 'npx', args: ['-y', 'a b', '&', '$(x)'], env: [{ name: 'API_TOKEN', value: 'v' }] })
    expect(stdio).toMatchObject({ ok: true, value: { command: 'npx', args: ['-y', 'a b', '&', '$(x)'], env: [{ name: 'API_TOKEN', value: 'v' }] } })
  })

  it.each([
    ['no name', { name: ' ', transport: 'http', url: 'https://x.test' }, 'name'],
    ['long name', { name: 'x'.repeat(41), transport: 'http', url: 'https://x.test' }, 'name'],
    ['external http', { name: 'n', transport: 'http', url: 'http://x.test' }, 'url'],
    ['unknown transport', { name: 'n', transport: 'ws', url: 'https://x.test' }, 'transport'],
    ['empty command', { name: 'n', transport: 'stdio', command: ' ' }, 'command'],
    ['command with NUL', { name: 'n', transport: 'stdio', command: 'a\0b' }, 'command'],
    ['args not a list', { name: 'n', transport: 'stdio', command: 'a', args: 'x y' }, 'args'],
    ['arg not a string', { name: 'n', transport: 'stdio', command: 'a', args: [1] }, 'args'],
    ['too many args', { name: 'n', transport: 'stdio', command: 'a', args: Array(101).fill('x') }, 'args'],
    ['bad env name', { name: 'n', transport: 'stdio', command: 'a', env: [{ name: '1BAD', value: 'v' }] }, 'env'],
    ['env name with =', { name: 'n', transport: 'stdio', command: 'a', env: [{ name: 'A=B', value: 'v' }] }, 'env'],
    ['duplicate env', { name: 'n', transport: 'stdio', command: 'a', env: [{ name: 'A', value: '1' }, { name: 'A', value: '2' }] }, 'env'],
    ['env value not a string', { name: 'n', transport: 'stdio', command: 'a', env: [{ name: 'A', value: 5 }] }, 'env']
  ])('refuses %s', (_name, input, field) => {
    expect(parseMcpAddInput(input)).toEqual({ ok: false, field })
  })

  it('refuses extra fields and mixed shapes (http with a command, stdio with a url)', () => {
    expect(parseMcpAddInput({ name: 'n', transport: 'http', url: 'https://x.test', command: 'a' }).ok).toBe(false)
    expect(parseMcpAddInput({ name: 'n', transport: 'stdio', command: 'a', url: 'https://x.test' }).ok).toBe(false)
    expect(parseMcpAddInput({ name: 'n', transport: 'http', url: 'https://x.test', id: 'mcp-x' }).ok).toBe(false)
    for (const bad of [null, 'x', [], 5]) expect(parseMcpAddInput(bad).ok).toBe(false)
  })
})

describe('saved servers (settings)', () => {
  const ok = { id: 'mcp-abcd1234', name: 'a', transport: 'stdio', command: 'npx', args: ['x'], envKeys: ['K'] }

  it('keeps only names of environment variables (there is no place for values), defaults to empty', () => {
    expect(defaultSetting('mcp.servers')).toEqual([])
    expect(defaultSetting('mcp.approvals')).toEqual([])
    expect(parseSetting('mcp.servers', [ok])).toEqual([ok])
    expect(parseSetting('mcp.servers', [{ ...ok, env: { K: 'secret-value' } }])).toEqual([ok]) // 모르는 필드는 버린다
    expect(JSON.stringify(parseSetting('mcp.servers', [{ ...ok, env: { K: 'secret-value' } }]))).not.toContain('secret-value')
  })

  it('refuses bad entries on save; on read a bad entry is dropped but the others survive', () => {
    expect(parseMcpServers([ok, ok])).toBeNull() // id 겹침
    expect(parseMcpServers([{ ...ok, id: 'x' }])).toBeNull()
    expect(parseMcpServers([{ ...ok, transport: 'http', url: 'http://evil.example.com' }])).toBeNull()
    expect(parseMcpServers('x')).toBeNull()
    expect(normalizeMcpServers([ok, { ...ok, id: 'bad' }, 5, null])).toEqual([ok])
    expect(readSetting('mcp.servers', 'garbage')).toEqual([])
  })

  it('approvals are {id, sha256}', () => {
    const hash = commandFingerprint('npx', [])
    expect(parseMcpApprovals([{ id: 'mcp-abcd1234', hash }])).toEqual([{ id: 'mcp-abcd1234', hash }])
    expect(parseMcpApprovals([{ id: 'mcp-abcd1234', hash: 'short' }])).toBeNull()
    expect(parseMcpApprovals([{ id: 'x', hash }])).toBeNull()
  })
})

describe('command line shown in the list', () => {
  it('quotes only what needs it', () => {
    expect(commandLine('npx', ['-y', 'a b', 'c'])).toBe('npx -y "a b" c')
    expect(commandLine('node', [])).toBe('node')
  })
})

describe('stdio confirmation dialog', () => {
  it('shows the command and every argument verbatim, one per line, with "취소" as the default', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 1, checkboxChecked: false }))
    const confirm = createCommandConfirm({ dialog: { showMessageBox } as never, getWindow: () => null })

    expect(await confirm({ name: '서버', command: 'C:\\Program Files\\node\\node.exe', args: ['a b', '&', '$(x)', '"q"'] })).toBe(true)

    const options = (showMessageBox.mock.calls as unknown as [{ detail: string; buttons: string[]; defaultId: number; cancelId: number; message: string }][])[0][0]
    expect(options.detail).toContain('명령: C:\\Program Files\\node\\node.exe')
    expect(options.detail).toContain('인자 1: a b')
    expect(options.detail).toContain('인자 2: &')
    expect(options.detail).toContain('인자 3: $(x)')
    expect(options.detail).toContain('인자 4: "q"')
    expect(options.message).toContain('서버')
    expect(options.buttons).toEqual(['취소', '실행'])
    expect(options.defaultId).toBe(0)
    expect(options.cancelId).toBe(0)
  })

  it('only the 실행 button allows it: cancel, Esc and closing the window all mean no', async () => {
    for (const response of [0, -1, 2]) {
      const confirm = createCommandConfirm({ dialog: { showMessageBox: async () => ({ response, checkboxChecked: false }) } as never, getWindow: () => null })
      expect(await confirm({ name: 'n', command: 'x', args: [] }), String(response)).toBe(false)
    }
  })

  it('attaches to the focused window when there is one', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 0, checkboxChecked: false }))
    const win = {} as never
    await createCommandConfirm({ dialog: { showMessageBox } as never, getWindow: () => win })({ name: 'n', command: 'x', args: [] })
    expect((showMessageBox.mock.calls as unknown as unknown[][])[0][0]).toBe(win)
  })

  it('describes a command without arguments', () => {
    expect(describeCommand('node', [])).toContain('인자 없음')
  })
})

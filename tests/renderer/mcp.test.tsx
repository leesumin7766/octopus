// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpSpawnError } from '../../src/main/arms/mcp/connection'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

const t = ko.arms.mcp
type User = ReturnType<typeof userEvent.setup>

describe('Arms screen: MCP servers', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const prepare = (): Backend => (b = installBackend('arms'))
  const show = async (): Promise<HTMLElement> => {
    render(<App />)
    return screen.findByRole('region', { name: t.title })
  }
  const form = (section: HTMLElement): HTMLElement => within(section).getByRole('form', { name: t.add })
  const server = (section: HTMLElement, name: string): Promise<HTMLElement> => within(section).findByRole('listitem', { name: t.serverLabel(name) })

  const addHttp = async (user: User, section: HTMLElement, name: string, url: string): Promise<void> => {
    await user.type(within(form(section)).getByLabelText(t.nameLabel), name)
    await user.type(within(form(section)).getByLabelText(t.urlLabel), url)
    await user.click(within(form(section)).getByRole('button', { name: t.add }))
  }

  it('starts empty, with the add form (kind, name, address) and no server cards in the Arm list', async () => {
    prepare()
    const section = await show()

    expect(await within(section).findByText(t.empty)).toBeTruthy()
    expect(within(form(section)).getByLabelText(t.kindLabel)).toBeTruthy()
    expect(within(form(section)).getByLabelText(t.urlLabel)).toBeTruthy()
    expect(within(form(section)).queryByLabelText(t.commandLabel)).toBeNull()
  })

  it('adds an address server: it connects, shows status, tool count and the tools with read/write marks', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const section = await show()

    await addHttp(user, section, '예시 노트', 'http://localhost:3000/mcp')

    const row = await server(section, '예시 노트')
    expect(backend.mcp.add).toHaveBeenCalledWith({ name: '예시 노트', transport: 'http', url: 'http://localhost:3000/mcp' })
    await waitFor(() => expect(within(row).getByText(ko.arms.statuses.on)).toBeTruthy())
    expect(within(row).getByText(t.toolCount(2))).toBeTruthy()
    expect(within(row).getByText('http://localhost:3000/mcp')).toBeTruthy()
    expect(screen.queryAllByRole('article', { name: /예시 노트/ })).toHaveLength(0) // 카드로는 보이지 않는다

    await user.click(within(row).getByRole('button', { name: t.showTools }))
    const tools = within(row).getByRole('list', { name: new RegExp(t.showTools) })
    const rows = within(tools).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText(/search_notes$/)).toBeTruthy()
    expect(within(rows[0]).getByText(t.readOnly)).toBeTruthy()
    expect(within(rows[1]).getByText(/create_page$/)).toBeTruthy()
    expect(within(rows[1]).getByText(t.write)).toBeTruthy()
    expect(within(form(section)).getByLabelText<HTMLInputElement>(t.nameLabel).value).toBe('') // 폼은 비워진다
  })

  it('an address that is not https (or localhost) is refused with a hint, and nothing is added', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const section = await show()

    await addHttp(user, section, '외부', 'http://example.com/mcp')

    expect((await within(form(section)).findByRole('alert')).textContent).toBe(t.errors.url)
    expect(backend.mcpService.list()).toEqual([])
  })

  it('a command server: arguments are one per line, environment values are password fields and never shown again', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const section = await show()
    const f = within(form(section))

    await user.selectOptions(f.getByLabelText(t.kindLabel), 'stdio')
    await user.type(f.getByLabelText(t.nameLabel), '도구 서버')
    await user.type(f.getByLabelText(t.commandLabel), 'npx')
    await user.type(f.getByLabelText(t.argsLabel), '-y{Enter}some-package{Enter}a b & c')
    await user.click(f.getByRole('button', { name: t.envAdd }))
    const value = f.getByLabelText(`${t.envValue} 1`) as HTMLInputElement
    expect(value.type).toBe('password')
    await user.type(f.getByLabelText(`${t.envName} 1`), 'API_TOKEN')
    await user.type(value, 'super-secret-xyz')
    await user.click(f.getByRole('button', { name: t.add }))

    const row = await server(section, '도구 서버')
    expect(backend.mcp.add).toHaveBeenCalledWith({
      name: '도구 서버',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'some-package', 'a b & c'], // 한 줄이 인자 하나
      env: [{ name: 'API_TOKEN', value: 'super-secret-xyz' }]
    })
    expect(backend.mcpConfirm).toHaveBeenCalledWith({ name: '도구 서버', command: 'npx', args: ['-y', 'some-package', 'a b & c'] })
    expect(within(row).getByText(t.envNames(['API_TOKEN']))).toBeTruthy()
    expect(within(row).getByText('npx -y some-package "a b & c"')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain('super-secret-xyz')
    expect(f.queryByLabelText(`${t.envValue} 1`)).toBeNull() // 환경 변수 줄도 비워졌다
  })

  it('refusing the first-run confirmation shows the error; [다시 연결] asks again and then connects', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.mcpConfirm.mockResolvedValue(false)
    const section = await show()
    const f = within(form(section))
    await user.selectOptions(f.getByLabelText(t.kindLabel), 'stdio')
    await user.type(f.getByLabelText(t.nameLabel), '도구 서버')
    await user.type(f.getByLabelText(t.commandLabel), 'some-tool')

    await user.click(f.getByRole('button', { name: t.add }))

    const row = await server(section, '도구 서버')
    expect((await within(row).findByRole('alert')).textContent).toContain('실행을 허용하지 않았어요')
    expect(within(row).getByText(ko.arms.statuses.error)).toBeTruthy()

    backend.mcpConfirm.mockResolvedValue(true)
    await user.click(within(row).getByRole('button', { name: t.reconnect }))

    await waitFor(() => expect(within(row).getByText(ko.arms.statuses.on)).toBeTruthy())
    expect(backend.mcpConfirm).toHaveBeenCalledTimes(2)
  })

  it('a server that cannot start shows its reason, and [다시 연결] works once it is fixed', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const working = backend.mcpConnector.current
    backend.mcpConnector.current = async () => {
      throw new McpSpawnError()
    }
    const section = await show()
    await addHttp(user, section, '불안정', 'https://mcp.example.com/mcp')
    const row = await server(section, '불안정')
    expect((await within(row).findByRole('alert')).textContent).toBeTruthy()
    expect(within(row).queryByRole('button', { name: t.showTools })).toBeNull()

    backend.mcpConnector.current = working
    await user.click(within(row).getByRole('button', { name: t.reconnect }))

    await waitFor(() => expect(within(row).getByText(t.toolCount(2))).toBeTruthy())
    expect(within(row).queryByRole('alert')).toBeNull()
  })

  it('deleting asks first ("환경 변수도 함께 지워져요"); cancel keeps it, confirm removes it and its tools', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const section = await show()
    await addHttp(user, section, '지울 서버', 'https://mcp.example.com/mcp')
    const row = await server(section, '지울 서버')
    await waitFor(() => expect(within(row).getByText(ko.arms.statuses.on)).toBeTruthy())
    expect(backend.armManager.tools().length).toBe(2)

    await user.click(within(row).getByRole('button', { name: t.remove }))
    expect(within(row).getByRole('alert').textContent).toContain(t.removeConfirm)
    expect(backend.mcp.remove).not.toHaveBeenCalled()
    await user.click(within(row).getByRole('button', { name: t.removeNo }))
    expect(within(section).getByRole('listitem', { name: t.serverLabel('지울 서버') })).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: t.remove }))
    await user.click(within(within(row).getByRole('alert')).getByRole('button', { name: t.removeYes }))

    await waitFor(() => expect(within(section).queryByRole('listitem', { name: t.serverLabel('지울 서버') })).toBeNull())
    expect(backend.mcp.remove).toHaveBeenCalledTimes(1)
    expect(backend.armManager.tools()).toEqual([])
    expect(within(section).getByText(t.empty)).toBeTruthy()
  })

  it('MCP tools are offered to the command session while connected', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const section = await show()
    await addHttp(user, section, 'Notes', 'https://mcp.example.com/mcp')
    await server(section, 'Notes')

    await waitFor(() => expect(backend.armManager.tools().map((x) => x.name)).toEqual(['Notes__search_notes', 'Notes__create_page']))
    expect(backend.armManager.tools().map((x) => x.readOnly)).toEqual([true, false])
  })
})

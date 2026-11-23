// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { DEFAULT_MODELS } from '../../src/shared/command/types'
import { installBackend, type Backend } from './backend'

const t = ko.settings.model
const SECRET = 'sk-ant-VERY-SECRET-123'
type User = ReturnType<typeof userEvent.setup>

describe('settings: model connection', () => {
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

  const prepare = (): Backend => (b = installBackend('settings'))
  const show = async (): Promise<HTMLElement> => {
    render(<App />)
    return screen.findByRole('region', { name: t.title })
  }
  const keyInput = (region: HTMLElement): HTMLInputElement => within(region).getByLabelText(/API 키/) as HTMLInputElement
  const provider = (region: HTMLElement): HTMLSelectElement => within(region).getByLabelText(t.providerLabel) as HTMLSelectElement

  it('the key field is a password field, and there is no "check connection" button', async () => {
    prepare()
    const region = await show()
    expect(keyInput(region).type).toBe('password')
    expect(within(region).queryByRole('button', { name: /확인|테스트/ })).toBeNull()
  })

  it('saving a key sends it once, empties the field, and shows only "저장됨" — the value never appears again', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const region = await show()
    expect(within(region).getByText(t.notSaved)).toBeTruthy()

    await user.type(keyInput(region), SECRET)
    await user.click(within(region).getByRole('button', { name: t.saveKey }))

    await waitFor(() => expect(within(region).getByText(t.saved)).toBeTruthy())
    expect(backend.command.setKey).toHaveBeenCalledWith('anthropic', SECRET)
    expect(backend.keys.anthropic).toBe(SECRET)
    expect(keyInput(region).value).toBe('')
    expect(document.body.textContent).not.toContain(SECRET)
    expect(document.body.innerHTML).not.toContain(SECRET)
    // 키를 읽어 오는 채널은 어디에도 없고, 목록 응답에도 키가 없다.
    const answers = await Promise.all(backend.command.models.mock.results.map((r) => r.value))
    expect(JSON.stringify(answers)).not.toContain(SECRET)
  })

  it('an empty key is not sent', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const region = await show()
    expect((within(region).getByRole('button', { name: t.saveKey }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(keyInput(region), '   ')
    expect((within(region).getByRole('button', { name: t.saveKey }) as HTMLButtonElement).disabled).toBe(true)
    expect(backend.command.setKey).not.toHaveBeenCalled()
  })

  it('clearing the key asks first, then removes it', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.keys.anthropic = SECRET
    const region = await show()
    await waitFor(() => expect(within(region).getByText(t.saved)).toBeTruthy())

    await user.click(within(region).getByRole('button', { name: t.clearKey }))
    expect(backend.command.clearKey).not.toHaveBeenCalled()
    await user.click(within(region).getByRole('button', { name: t.clearNo }))
    expect(backend.keys.anthropic).toBe(SECRET)

    await user.click(within(region).getByRole('button', { name: t.clearKey }))
    await user.click(within(region).getByRole('button', { name: t.clearYes }))

    await waitFor(() => expect(within(region).getByText(t.notSaved)).toBeTruthy())
    expect(backend.command.clearKey).toHaveBeenCalledWith('anthropic')
    expect(backend.keys.anthropic).toBeUndefined()
  })

  it('Anthropic model list comes from command.models, defaulting to Opus 5.5; choosing saves command.model', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    const region = await show()
    const select = (await within(region).findByLabelText(t.modelLabel)) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBe(DEFAULT_MODELS.length))
    expect(select.value).toBe('anthropic-opus')
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(DEFAULT_MODELS.map((m) => m.label))

    await user.selectOptions(select, 'anthropic-sonnet')

    await waitFor(() => expect(backend.settingsRepo.get('command.model')).toBe('anthropic-sonnet'))
    expect(backend.settings.set).toHaveBeenCalledWith('command.model', 'anthropic-sonnet')
  })

  describe('OpenAI-compatible', () => {
    const fill = async (user: User, region: HTMLElement, url: string, model: string): Promise<void> => {
      await user.selectOptions(provider(region), 'openai-compatible')
      const urlBox = within(region).getByLabelText(t.baseUrlLabel)
      await user.clear(urlBox)
      if (url) await user.type(urlBox, url)
      const modelBox = within(region).getByLabelText(t.modelNameLabel)
      await user.clear(modelBox)
      if (model) await user.type(modelBox, model)
    }

    it('refuses an address that is not http(s) and a missing model name; nothing is saved', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const region = await show()

      await fill(user, region, 'ftp://example.com', 'gpt')
      await user.click(within(region).getByRole('button', { name: t.saveServer }))
      expect((await within(region).findByRole('alert')).textContent).toBe(t.errors.baseUrl)

      await fill(user, region, 'javascript:alert(1)', 'gpt')
      await user.click(within(region).getByRole('button', { name: t.saveServer }))
      expect(within(region).getByRole('alert').textContent).toBe(t.errors.baseUrl)

      await fill(user, region, 'http://localhost:1234/v1', '')
      await user.click(within(region).getByRole('button', { name: t.saveServer }))
      expect(within(region).getByRole('alert').textContent).toBe(t.errors.modelName)

      expect(backend.settings.set).not.toHaveBeenCalledWith('command.models', expect.anything())
    })

    it('saves a local address without any key, keeps the defaults, and selects the new model', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const region = await show()

      await fill(user, region, 'http://localhost:1234/v1', 'qwen2.5')
      await user.click(within(region).getByRole('button', { name: t.saveServer }))

      await waitFor(() => expect(backend.settingsRepo.get('command.model')).toBe('openai-compatible'))
      expect(backend.settingsRepo.get('command.models')).toEqual([
        ...DEFAULT_MODELS,
        { id: 'openai-compatible', provider: 'openai-compatible', model: 'qwen2.5', label: 'qwen2.5', baseUrl: 'http://localhost:1234/v1' }
      ])
      expect(backend.command.setKey).not.toHaveBeenCalled()
      expect(await within(region).findByText(t.serverSaved)).toBeTruthy()
    })

    it('an optional key is stored when given, and then not shown', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const region = await show()
      await fill(user, region, 'https://api.example.com/v1', 'm1')
      await user.type(keyInput(region), SECRET)

      await user.click(within(region).getByRole('button', { name: t.saveServer }))

      await waitFor(() => expect(backend.command.setKey).toHaveBeenCalledWith('openai-compatible', SECRET))
      expect(keyInput(region).value).toBe('')
      expect(document.body.textContent).not.toContain(SECRET)
      await waitFor(() => expect(within(region).getByText(t.saved)).toBeTruthy())
    })

    it('saving the server again replaces it instead of adding a second one', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const region = await show()
      await fill(user, region, 'http://localhost:1/v1', 'one')
      await user.click(within(region).getByRole('button', { name: t.saveServer }))
      await waitFor(() => expect(backend.settingsRepo.get('command.models')).toHaveLength(DEFAULT_MODELS.length + 1))

      await fill(user, region, 'http://localhost:2/v1', 'two')
      await user.click(within(region).getByRole('button', { name: t.saveServer }))

      await waitFor(() => expect(backend.settingsRepo.get('command.models').at(-1)?.model).toBe('two'))
      expect(backend.settingsRepo.get('command.models')).toHaveLength(DEFAULT_MODELS.length + 1)
    })
  })
})

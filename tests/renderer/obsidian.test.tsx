// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IGNORE_LINE } from '../../src/main/arms/obsidian/gitCheck'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

const t = ko.obsidian
const arms = ko.arms

describe('Obsidian settings screen', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(async () => {
    cleanup()
    await b?.obsidianArm.disconnect()
    b?.armManager.dispose()
    b?.t.db.close()
    rmSync(b.vault, { recursive: true, force: true })
    vi.useRealTimers()
  })

  /** 앱을 그려 Arms → 옵시디언 [설정] 으로 간다. */
  async function gotoSettings(): Promise<void> {
    render(<App />)
    const user = userEvent.setup()
    const nav = await screen.findByRole('navigation', { name: ko.nav.label })
    await user.click(within(nav).getByRole('button', { name: ko.nav.arms }))
    const card = await screen.findByRole('article', { name: arms.cardLabel('옵시디언') })
    await user.click(within(card).getByRole('button', { name: arms.settings }))
    await screen.findByRole('heading', { level: 1, name: t.title })
  }

  /** 옵시디언 Arm 을 등록하고 설정 화면을 연다. connected=true 면 먼저 연결해 둔다. */
  async function open(options: { connected?: boolean; git?: boolean; setup?: (backend: Backend) => void } = {}): Promise<Backend> {
    b = installBackend('home')
    b.armManager.register(b.obsidianArm)
    if (options.git) mkdirSync(join(b.vault, '.git'))
    options.setup?.(b)
    if (options.connected !== false) await b.armManager.connect('obsidian')
    await gotoSettings()
    return b
  }
  const preview = (): HTMLElement => screen.getByRole('region', { name: t.previewTitle })
  const exportedFile = (): string => join(b.vault, 'Octopus', '할 일.md')

  it('the Arms card has a [설정] button that opens this screen, and ← Arms goes back', async () => {
    const user = userEvent.setup()
    await open()
    expect(screen.getByText(t.intro)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: t.back }))
    expect(await screen.findByRole('heading', { level: 1, name: /Arms/ })).toBeTruthy()
  })

  it('shows three ways to use it, "export only" recommended and selected by default', async () => {
    await open()
    const group = screen.getByRole('radiogroup', { name: t.modeTitle })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([
      `${t.modes.off.title}${t.modes.off.desc}`,
      `${t.modes.export.title}${t.modes.export.recommended}${t.modes.export.desc}`,
      `${t.modes.both.title}${t.modes.both.desc}`
    ])
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('the preview is made from the real tasks (as plain text), and the file in the vault has the same content', async () => {
    await open({
      connected: false,
      setup: (backend) => {
        backend.t.repo.create({ title: '화면에서 보이는 일', date: '2026-03-10', bucket: 'scheduled', time: '09:30' })
        backend.t.repo.create({ title: '<b>굵게</b> 시도' })
      }
    })
    expect(within(preview()).getByText(t.noPreview)).toBeTruthy() // 연결 전에는 미리보기가 없다
    cleanup()
    await b.armManager.connect('obsidian')
    await gotoSettings()

    const pre = await within(await screen.findByRole('region', { name: t.previewTitle })).findByLabelText(t.previewTitle)
    expect(pre.tagName).toBe('PRE')
    expect(pre.textContent).toContain('- [ ] 화면에서 보이는 일 09:30')
    expect(pre.textContent).toContain('\\<b\\>굵게\\</b\\> 시도') // 마크다운 특수 문자는 막아서 내보낸다
    expect(pre.querySelector('b')).toBeNull() // HTML 로 해석하지 않는다
    expect(pre.textContent).toBe(readFileSync(exportedFile(), 'utf8'))
  })

  it('the preview never contains example text from anywhere else — only this app\'s own tasks', async () => {
    await open()
    const text = (await within(preview()).findByLabelText(t.previewTitle)).textContent as string
    expect(text).toContain('## 오늘 · 3월 10일 화요일')
    expect(text.replace(/<!--.*?-->/g, '')).not.toMatch(/- \[[ x]\] /) // 할 일이 없으면 할 일 줄도 없다
  })

  it('choosing a mode saves it right away; "both" adds the writing section to the preview and the file', async () => {
    const user = userEvent.setup()
    await open()
    const both = within(screen.getByRole('radiogroup', { name: t.modeTitle })).getAllByRole('radio')[2]

    await user.click(both)

    await waitFor(() => expect(both.getAttribute('aria-checked')).toBe('true'))
    expect(b.obsidian.setConfig).toHaveBeenCalledWith({ mode: 'both' })
    expect(b.settingsRepo.get('obsidian.config').mode).toBe('both')
    expect((await within(preview()).findByLabelText(t.previewTitle)).textContent).toContain('## 적어 넣기')
    expect(readFileSync(exportedFile(), 'utf8')).toContain('## 적어 넣기')
  })

  it('"쓰지 않음" hides the rest and writes nothing more', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(within(screen.getByRole('radiogroup', { name: t.modeTitle })).getAllByRole('radio')[0])
    await waitFor(() => expect(screen.queryByRole('region', { name: t.vaultTitle })).toBeNull())
    expect(within(preview()).getByText(t.noPreview)).toBeTruthy()
  })

  it('shows the vault path with [바꾸기] (the folder dialog is opened by main), and warns when it does not look like a vault', async () => {
    const user = userEvent.setup()
    await open({ setup: (backend) => rmSync(join(backend.vault, '.obsidian'), { recursive: true, force: true }) })
    const section = screen.getByRole('region', { name: t.vaultTitle })
    expect(within(section).getByText(b.vault)).toBeTruthy()
    expect(within(section).getByText(t.notVault)).toBeTruthy()

    await user.click(within(section).getByRole('button', { name: t.changeVault }))

    expect(b.obsidian.changeVault).toHaveBeenCalledWith() // 렌더러는 경로를 보내지 않는다
  })

  it('the export file path is validated: a path that leaves the vault or is not .md is refused with a hint; a good one is saved and written', async () => {
    const user = userEvent.setup()
    await open()
    const section = screen.getByRole('region', { name: t.vaultTitle })
    const input = within(section).getByLabelText(t.fileLabel) as HTMLInputElement

    for (const bad of ['../밖.md', 'C:\\x.md', '/abs.md', '메모.txt']) {
      await user.clear(input)
      await user.type(input, bad)
      await user.click(within(section).getByRole('button', { name: t.saveFile }))
      expect((await within(section).findByRole('alert')).textContent).toBe(t.fileError)
    }
    expect(b.obsidian.setConfig).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, '보관/내 할 일.md')
    await user.click(within(section).getByRole('button', { name: t.saveFile }))

    expect(await within(section).findByText(t.fileSaved)).toBeTruthy()
    expect(b.obsidian.setConfig).toHaveBeenCalledWith({ file: '보관/내 할 일.md' })
    expect(existsSync(join(b.vault, '보관', '내 할 일.md'))).toBe(true)
  })

  it('the daily-note checkbox is off by default and saves when toggled', async () => {
    const user = userEvent.setup()
    await open()
    const box = screen.getByRole('checkbox', { name: new RegExp(t.daily) }) as HTMLInputElement
    expect(box.checked).toBe(false)
    await user.click(box)
    await waitFor(() => expect(b.settingsRepo.get('obsidian.config').dailyNote).toBe(true))
    expect(b.obsidian.setConfig).toHaveBeenCalledWith({ dailyNote: true })
  })

  it('[지금 내보내기] rewrites the file and shows the time of the last export', async () => {
    const user = userEvent.setup()
    await open()
    b.t.repo.create({ title: '방금 만든 일' })
    writeFileSync(exportedFile(), '손으로 고친 내용')

    await user.click(screen.getByRole('button', { name: t.exportNow }))

    await waitFor(() => expect(readFileSync(exportedFile(), 'utf8')).toContain('- [ ] 방금 만든 일'))
    expect(await screen.findByText(/마지막으로 내보낸 시각 3\/10 12:00/)).toBeTruthy()
  })

  it('a vault that has disappeared shows the reason, and the rest of the app still works', async () => {
    const user = userEvent.setup()
    await open()
    rmSync(b.vault, { recursive: true, force: true })

    await user.click(screen.getByRole('button', { name: t.exportNow }))

    expect((await screen.findAllByRole('alert')).some((a) => a.textContent?.includes('vault 폴더를 찾을 수 없어요'))).toBe(true)
    expect(b.t.repo.create({ title: '계속 동작' }).title).toBe('계속 동작')
  })

  describe('sync check (git)', () => {
    it('a vault that is not a git repository has nothing to check', async () => {
      await open()
      expect(within(screen.getByRole('region', { name: t.syncTitle })).getByText(t.gitNone)).toBeTruthy()
    })

    it('git vault without the ignore line: warns and offers a button; it asks first (showing the exact line) and only then writes', async () => {
      const user = userEvent.setup()
      await open({ git: true })
      const section = screen.getByRole('region', { name: t.syncTitle })
      expect((await within(section).findByRole('alert')).textContent).toBe(t.gitMissing)
      const button = within(section).getByRole('button', { name: t.gitAdd(IGNORE_LINE) })

      b.obsidianConfirm.mockResolvedValueOnce(false)
      await user.click(button)
      expect(b.obsidianConfirm).toHaveBeenCalledWith({ path: join(b.vault, '.gitignore'), line: IGNORE_LINE })
      expect(existsSync(join(b.vault, '.gitignore'))).toBe(false) // 거부하면 아무것도 쓰지 않는다

      const again = (): HTMLButtonElement => within(section).getByRole('button', { name: t.gitAdd(IGNORE_LINE) }) as HTMLButtonElement
      await waitFor(() => expect(again().disabled).toBe(false)) // 앞의 요청이 끝날 때까지 잠겨 있다
      await user.click(again())
      await waitFor(() => expect(within(section).getByText(t.gitOk)).toBeTruthy())
      expect(readFileSync(join(b.vault, '.gitignore'), 'utf8')).toBe(`${IGNORE_LINE}\n`)
    })

    it('when the line is already there nothing is shown to fix', async () => {
      await open({ git: true, setup: (backend) => writeFileSync(join(backend.vault, '.gitignore'), `node_modules/\n${IGNORE_LINE}\n`) })
      expect(await within(screen.getByRole('region', { name: t.syncTitle })).findByText(t.gitOk)).toBeTruthy()
    })
  })

  describe('home pie menu 옵시디언 wedge', () => {
    const wedge = (): HTMLElement => within(screen.getByRole('menu')).getAllByRole('menuitem')[6]

    it('is disabled until Obsidian is connected', async () => {
      const user = userEvent.setup()
      b = installBackend('home')
      b.armManager.register(b.obsidianArm)
      render(<App />)
      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
      expect(wedge().getAttribute('aria-label')).toBe(ko.pie.labels['arm:obsidian'])
      expect(wedge().getAttribute('aria-disabled')).toBe('true')
    })

    it('when connected it opens an obsidian:// address that main builds (the screen sends only the action)', async () => {
      const user = userEvent.setup()
      b = installBackend('home')
      b.armManager.register(b.obsidianArm)
      await b.armManager.connect('obsidian')
      render(<App />)
      await user.click(await screen.findByRole('button', { name: ko.pie.menuLabel }))
      await waitFor(() => expect(wedge().getAttribute('aria-disabled')).toBeNull())

      await user.click(wedge())

      await waitFor(() => expect(b.opened.some((u) => u.startsWith('obsidian://open?'))).toBe(true))
      const url = new URL(b.opened.find((u) => u.startsWith('obsidian://')) as string)
      expect(url.searchParams.get('file')).toBe('Octopus/할 일.md')
      expect(b.obsidian.open).toHaveBeenCalledWith()
    })
  })
})

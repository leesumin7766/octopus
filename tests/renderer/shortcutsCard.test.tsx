// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

const t = ko.home.shortcuts

describe('shortcuts card', () => {
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

  const prepare = (): Backend => (b = installBackend('home'))
  const card = async (): Promise<HTMLElement> => {
    render(<App />)
    return screen.findByRole('region', { name: ko.home.cards.shortcuts })
  }
  const file = (name: string): string => join(tmpdir(), name)

  describe('the list', () => {
    it('is an empty state with the add button when there are none', async () => {
      prepare()
      const shortcuts = await card()

      expect(await within(shortcuts).findByText(t.empty)).toBeTruthy()
      expect(within(shortcuts).getByRole('button', { name: t.add })).toBeTruthy()
      expect(within(shortcuts).queryByRole('button', { name: t.manage })).toBeNull()
    })

    it('shows each shortcut with its name, kind and a hint of what it opens', async () => {
      const backend = prepare()
      backend.shortcutRepo.createUrl({ url: 'https://example.com/docs', label: '문서' })
      backend.shortcutRepo.createPath({ path: file('report.pdf'), pathType: 'file' })
      backend.shortcutRepo.createPath({ path: file('projects'), pathType: 'folder', label: '프로젝트' })
      const shortcuts = await card()

      const link = await within(shortcuts).findByRole('button', { name: '문서' })
      expect(link.getAttribute('title')).toBe('https://example.com/docs')
      expect(link.textContent).toContain(t.kinds.url)
      expect(within(shortcuts).getByRole('button', { name: 'report.pdf' }).textContent).toContain(t.kinds.file)
      expect(within(shortcuts).getByRole('button', { name: '프로젝트' }).textContent).toContain(t.kinds.folder)
      // 아이콘은 인라인 SVG
      for (const button of within(shortcuts).getAllByRole('listitem')) expect(button.querySelector('svg')).not.toBeNull()
    })
  })

  describe('opening', () => {
    it('a link opens in the browser — the renderer only names the shortcut by id', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const link = backend.shortcutRepo.createUrl({ url: 'https://example.com/docs', label: '문서' })
      const shortcuts = await card()

      await user.click(await within(shortcuts).findByRole('button', { name: '문서' }))

      await waitFor(() => expect(backend.shortcuts.open).toHaveBeenCalledWith(link.id))
      expect(backend.shortcuts.open).toHaveBeenCalledTimes(1)
      expect(backend.platform.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    })

    it('a file and a folder open with the system', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.shortcutRepo.createPath({ path: file('report.pdf'), pathType: 'file' })
      backend.shortcutRepo.createPath({ path: file('projects'), pathType: 'folder', label: '프로젝트' })
      const shortcuts = await card()

      await user.click(await within(shortcuts).findByRole('button', { name: 'report.pdf' }))
      await user.click(within(shortcuts).getByRole('button', { name: '프로젝트' }))

      await waitFor(() => expect(backend.platform.openPath).toHaveBeenCalledTimes(2))
      expect(backend.platform.openPath).toHaveBeenCalledWith(file('report.pdf'))
      expect(backend.platform.openPath).toHaveBeenCalledWith(file('projects'))
    })

    it('says the file is gone when it was moved or deleted, and offers to fix or remove the shortcut', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.shortcutRepo.createPath({ path: file('gone.pdf'), pathType: 'file' })
      backend.platform.pathExists.mockReturnValue(false)
      const shortcuts = await card()

      await user.click(await within(shortcuts).findByRole('button', { name: 'gone.pdf' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(ko.tasks.errors.not_found_path)
      expect(alert.textContent).toContain('바로가기를 고치거나 지우세요')
      expect(backend.platform.openPath).not.toHaveBeenCalled()
    })

    it('a program asks first; saying no opens nothing and shows no error', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.shortcutRepo.createPath({ path: file('setup.exe'), pathType: 'file' })
      backend.platform.confirmRunExecutable.mockResolvedValueOnce(false)
      const shortcuts = await card()

      await user.click(await within(shortcuts).findByRole('button', { name: 'setup.exe' }))

      await waitFor(() => expect(backend.platform.confirmRunExecutable).toHaveBeenCalledTimes(1))
      expect(backend.platform.openPath).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('saying yes opens it, and the next time there is no question', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.shortcutRepo.createPath({ path: file('setup.exe'), pathType: 'file' })
      const shortcuts = await card()
      const button = await within(shortcuts).findByRole('button', { name: 'setup.exe' })

      await user.click(button)
      await waitFor(() => expect(backend.platform.openPath).toHaveBeenCalledTimes(1))
      await user.click(button)
      await waitFor(() => expect(backend.platform.openPath).toHaveBeenCalledTimes(2))

      expect(backend.platform.confirmRunExecutable).toHaveBeenCalledTimes(1)
    })

    it('shows a message when opening fails for another reason', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.shortcutRepo.createUrl({ url: 'https://example.com', label: '예시' })
      backend.platform.openExternal.mockRejectedValueOnce(new Error('boom'))
      const shortcuts = await card()

      await user.click(await within(shortcuts).findByRole('button', { name: '예시' }))

      expect((await screen.findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
    })
  })

  describe('adding', () => {
    it('a link: address and optional name, saved through addUrl', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const shortcuts = await card()

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      await user.type(within(shortcuts).getByLabelText(t.urlLabel), 'https://example.com/guide')
      await user.type(within(shortcuts).getByLabelText(t.nameLabel), '안내서')
      await user.click(within(shortcuts).getByRole('button', { name: t.submit }))

      await waitFor(() => expect(backend.shortcuts.addUrl).toHaveBeenCalledWith({ url: 'https://example.com/guide', label: '안내서' }))
      expect(await within(shortcuts).findByRole('button', { name: '안내서' })).toBeTruthy()
      expect(within(shortcuts).queryByLabelText(t.urlLabel)).toBeNull() // 폼은 닫힌다
    })

    it('without a name, the name is the host name', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const shortcuts = await card()

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      await user.type(within(shortcuts).getByLabelText(t.urlLabel), 'https://docs.example.com/x{Enter}')

      await waitFor(() => expect(backend.shortcuts.addUrl).toHaveBeenCalledWith({ url: 'https://docs.example.com/x' }))
      expect(await within(shortcuts).findByRole('button', { name: 'docs.example.com' })).toBeTruthy()
    })

    it('refuses javascript:, file: and addresses without a scheme, and says what is needed', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const shortcuts = await card()
      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      const address = within(shortcuts).getByLabelText(t.urlLabel)

      for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'example.com']) {
        await user.clear(address)
        await user.type(address, `${bad}{Enter}`)
        expect((await within(shortcuts).findByRole('alert')).textContent).toBe(t.errors.url)
      }

      expect(backend.shortcutRepo.list()).toEqual([])
      expect(within(shortcuts).getByLabelText(t.urlLabel)).toBeTruthy() // 폼은 열린 채로
    })

    it('a too long name is reported next to the form', async () => {
      const user = userEvent.setup()
      prepare()
      const shortcuts = await card()
      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))

      await user.type(within(shortcuts).getByLabelText(t.urlLabel), 'https://example.com')
      await user.type(within(shortcuts).getByLabelText(t.nameLabel), 'x'.repeat(101))
      await user.click(within(shortcuts).getByRole('button', { name: t.submit }))

      expect((await within(shortcuts).findByRole('alert')).textContent).toBe(t.errors.label)
    })

    it('a file comes from the system file chooser, not from anything typed in the page', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.platform.pickPath.mockResolvedValueOnce(file('report.pdf'))
      const shortcuts = await card()

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addFile }))

      await waitFor(() => expect(backend.shortcuts.pickPath).toHaveBeenCalledWith('file'))
      expect(backend.shortcuts.pickPath.mock.calls[0]).toEqual(['file']) // 경로 같은 다른 인자는 없다
      expect(backend.platform.pickPath).toHaveBeenCalledWith('file')
      expect(await within(shortcuts).findByRole('button', { name: 'report.pdf' })).toBeTruthy()
    })

    it('a folder is picked the same way', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      backend.platform.pickPath.mockResolvedValueOnce(file('projects'))
      const shortcuts = await card()

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addFolder }))

      await waitFor(() => expect(backend.shortcuts.pickPath).toHaveBeenCalledWith('folder'))
      const added = await within(shortcuts).findByRole('button', { name: 'projects' })
      expect(added.textContent).toContain(t.kinds.folder)
    })

    it('cancelling the chooser saves nothing and shows no error', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const shortcuts = await card()

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addFile })) // 기본 가짜는 취소(null)

      await waitFor(() => expect(backend.shortcuts.pickPath).toHaveBeenCalled())
      expect(backend.shortcutRepo.list()).toEqual([])
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('the add menu can be cancelled', async () => {
      const user = userEvent.setup()
      prepare()
      const shortcuts = await card()

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.cancel }))

      expect(within(shortcuts).queryByRole('group', { name: t.addMenuLabel })).toBeNull()
      expect(within(shortcuts).getByRole('button', { name: t.add })).toBeTruthy()
    })
  })

  describe('managing', () => {
    function seed(backend: Backend) {
      return ['A', 'B', 'C'].map((label) => backend.shortcutRepo.createUrl({ url: `https://${label.toLowerCase()}.example`, label }))
    }

    it('rename', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const [first] = seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByText('A')

      await user.click(within(shortcuts).getByRole('button', { name: t.manage }))
      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      const input = within(shortcuts).getByLabelText(t.renameLabel('A'))
      await user.clear(input)
      await user.type(input, '새 이름{Enter}')

      await waitFor(() => expect(backend.shortcuts.rename).toHaveBeenCalledWith(first.id, '새 이름'))
      expect(await within(shortcuts).findByText('새 이름')).toBeTruthy()
    })

    it('an empty new name is refused with a message', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByText('A')

      await user.click(within(shortcuts).getByRole('button', { name: t.manage }))
      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      await user.clear(within(shortcuts).getByLabelText(t.renameLabel('A')))
      await user.keyboard('{Enter}')

      expect((await within(shortcuts).findByRole('alert')).textContent).toBe(t.errors.label)
      expect(backend.shortcutRepo.list()[0].label).toBe('A')
    })

    it('up and down buttons change the order, and are disabled at the ends', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByText('A')
      await user.click(within(shortcuts).getByRole('button', { name: t.manage }))
      const names = () => backend.shortcutRepo.list().map((s) => s.label)

      expect((within(shortcuts).getByRole('button', { name: t.moveUp('A') }) as HTMLButtonElement).disabled).toBe(true)
      expect((within(shortcuts).getByRole('button', { name: t.moveDown('C') }) as HTMLButtonElement).disabled).toBe(true)

      await user.click(within(shortcuts).getByRole('button', { name: t.moveDown('A') }))
      await waitFor(() => expect(names()).toEqual(['B', 'A', 'C']))
      await user.click(within(shortcuts).getByRole('button', { name: t.moveUp('C') }))
      await waitFor(() => expect(names()).toEqual(['B', 'C', 'A']))
      expect(within(shortcuts).getAllByRole('listitem').map((li) => li.textContent?.slice(0, 1))).toEqual(['B', 'C', 'A'])
    })

    it('delete asks first; cancelling keeps it, confirming removes it (the file itself is untouched)', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const [first] = seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByText('A')
      await user.click(within(shortcuts).getByRole('button', { name: t.manage }))

      await user.click(within(shortcuts).getAllByRole('button', { name: t.remove })[0])
      const sure = within(shortcuts).getByRole('alertdialog')
      expect(within(sure).getByText(t.confirmRemove)).toBeTruthy()
      expect(backend.shortcuts.remove).not.toHaveBeenCalled()

      await user.click(within(sure).getByRole('button', { name: t.cancel }))
      expect(within(shortcuts).queryByRole('alertdialog')).toBeNull()

      await user.click(within(shortcuts).getAllByRole('button', { name: t.remove })[0])
      await user.click(within(within(shortcuts).getByRole('alertdialog')).getByRole('button', { name: t.confirmRemoveYes }))

      await waitFor(() => expect(backend.shortcuts.remove).toHaveBeenCalledWith(first.id))
      await waitFor(() => expect(within(shortcuts).queryByText('A')).toBeNull())
      expect(backend.platform.openPath).not.toHaveBeenCalled()
    })

    it('leaving manage mode shows plain open buttons again', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByText('A')

      await user.click(within(shortcuts).getByRole('button', { name: t.manage }))
      expect(within(shortcuts).queryByRole('button', { name: 'A' })).toBeNull() // 관리 중에는 열기 버튼이 없다
      await user.click(within(shortcuts).getByRole('button', { name: t.doneManage }))

      expect(within(shortcuts).getByRole('button', { name: 'A' })).toBeTruthy()
    })
  })
})

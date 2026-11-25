// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { notifyDataChanged } from '../../src/renderer/dataEvents'
import { ko } from '../../src/renderer/i18n/ko'
import type { IpcResult } from '../../src/shared/ipc'
import { installBackend, type Backend } from './backend'

// S1: 바로가기 타일·편집 모드·저장 안정성 (docs/acceptance/dev2-home.md S1-01~08)

const t = ko.home.shortcuts

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('S1 shortcut tiles and edit mode', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 24, 12, 0, 0))
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
  const seed = (backend: Backend) => [
    backend.shortcutRepo.createUrl({ url: 'https://a.example/docs', label: 'A 문서' }),
    backend.shortcutRepo.createPath({ path: file('report.pdf'), pathType: 'file' }),
    backend.shortcutRepo.createPath({ path: file('projects'), pathType: 'folder', label: '프로젝트' })
  ]
  const enterEdit = async (user: ReturnType<typeof userEvent.setup>, shortcuts: HTMLElement): Promise<void> => {
    await user.click(within(shortcuts).getByRole('button', { name: t.manage }))
  }

  describe('S1-01 normal mode tiles', () => {
    it('shows a responsive tile grid in the saved order with icon, name and kind', async () => {
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })

      const list = within(shortcuts).getByRole('list')
      // 카드 너비에 따라 열 수가 바뀌는 격자(auto-fill)
      expect(list.className).toContain('grid')
      expect(list.className).toContain('auto-fill')

      const tiles = within(list).getAllByRole('button')
      expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual(['A 문서', 'report.pdf', '프로젝트'])
      expect(tiles[0].querySelector('svg')).not.toBeNull()
      expect(tiles[0].textContent).toContain(t.kinds.url)
      expect(tiles[1].textContent).toContain(t.kinds.file)
      expect(tiles[2].textContent).toContain(t.kinds.folder)
    })
  })

  describe('S1-02 edit mode never opens anything', () => {
    it('clicking a tile, its name or the edit buttons calls no open', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      backend.shortcutRepo.createPath({ path: file('setup.exe'), pathType: 'file' })
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })

      await enterEdit(user, shortcuts)
      expect(within(shortcuts).getByText(t.editHint)).toBeTruthy()
      for (const item of within(shortcuts).getAllByRole('listitem')) await user.click(item)
      await user.click(within(shortcuts).getByText('setup.exe'))
      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      await user.keyboard('{Escape}')

      expect(backend.shortcuts.open).not.toHaveBeenCalled()
      expect(backend.platform.openExternal).not.toHaveBeenCalled()
      expect(backend.platform.openPath).not.toHaveBeenCalled()
      expect(backend.platform.confirmRunExecutable).not.toHaveBeenCalled()
    })
  })

  describe('S1-03 cancel keeps the store untouched', () => {
    it('cancelling delete, rename and add leaves the saved shortcuts as they were', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const before = backend.shortcutRepo.list()
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })
      await enterEdit(user, shortcuts)

      await user.click(within(shortcuts).getAllByRole('button', { name: t.remove })[1])
      await user.click(within(within(shortcuts).getByRole('alertdialog')).getByRole('button', { name: t.cancel }))

      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      await user.type(within(shortcuts).getByLabelText(t.renameLabel('A 문서')), ' 바뀜')
      await user.click(within(shortcuts).getByRole('button', { name: t.cancel }))

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      await user.type(within(shortcuts).getByLabelText(t.urlLabel), 'https://new.example')
      await user.click(within(shortcuts).getByRole('button', { name: t.cancel }))

      expect(backend.shortcuts.remove).not.toHaveBeenCalled()
      expect(backend.shortcuts.rename).not.toHaveBeenCalled()
      expect(backend.shortcuts.addUrl).not.toHaveBeenCalled()
      expect(backend.shortcutRepo.list()).toEqual(before)
    })
  })

  describe('S1-04 repeated clicks and failures', () => {
    it('clicking add twice and pressing Enter while saving creates one shortcut', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const shortcuts = await card()
      const real = backend.shortcuts.addUrl.getMockImplementation()!
      const gate = deferred<void>()
      backend.shortcuts.addUrl.mockImplementation(async (input) => {
        await gate.promise
        return real(input)
      })

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      const address = within(shortcuts).getByLabelText(t.urlLabel)
      await user.type(address, 'https://once.example')
      const submit = within(shortcuts).getByRole('button', { name: t.submit })
      await user.click(submit)
      await user.click(submit)
      address.focus()
      await user.keyboard('{Enter}')

      expect(backend.shortcuts.addUrl).toHaveBeenCalledTimes(1)
      expect((address as HTMLInputElement).value).toBe('https://once.example') // 저장 중에도 입력은 그대로
      await act(async () => gate.resolve())

      await within(shortcuts).findByRole('button', { name: 'once.example' })
      expect(backend.shortcutRepo.list()).toHaveLength(1)
    })

    it('a failed save keeps the typed values and the existing list, and retrying saves once', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })
      backend.shortcuts.addUrl.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      await user.type(within(shortcuts).getByLabelText(t.urlLabel), 'https://retry.example')
      await user.type(within(shortcuts).getByLabelText(t.nameLabel), '다시')
      await user.click(within(shortcuts).getByRole('button', { name: t.submit }))

      expect((await within(shortcuts).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect((within(shortcuts).getByLabelText(t.urlLabel) as HTMLInputElement).value).toBe('https://retry.example')
      expect((within(shortcuts).getByLabelText(t.nameLabel) as HTMLInputElement).value).toBe('다시')
      expect(within(shortcuts).getAllByRole('listitem')).toHaveLength(3)

      await user.click(within(shortcuts).getByRole('button', { name: t.submit }))
      await within(shortcuts).findByRole('button', { name: '다시' })
      expect(backend.shortcutRepo.list().filter((s) => s.label === '다시')).toHaveLength(1)
    })

    it('a pending move or rename is sent only once', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })
      await enterEdit(user, shortcuts)

      const realMove = backend.shortcuts.move.getMockImplementation()!
      const moveGate = deferred<void>()
      backend.shortcuts.move.mockImplementation(async (id, direction) => {
        await moveGate.promise
        return realMove(id, direction)
      })
      const down = within(shortcuts).getByRole('button', { name: t.moveDown('A 문서') })
      await user.click(down)
      await user.click(down)
      expect(backend.shortcuts.move).toHaveBeenCalledTimes(1)
      await act(async () => moveGate.resolve())
      await waitFor(() => expect(backend.shortcutRepo.list().map((s) => s.label)).toEqual(['report.pdf', 'A 문서', '프로젝트']))

      const realRename = backend.shortcuts.rename.getMockImplementation()!
      const renameGate = deferred<void>()
      backend.shortcuts.rename.mockImplementation(async (id, label) => {
        await renameGate.promise
        return realRename(id, label)
      })
      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      const input = within(shortcuts).getByLabelText(t.renameLabel('report.pdf'))
      await user.clear(input)
      await user.type(input, '보고서{Enter}{Enter}')
      expect(backend.shortcuts.rename).toHaveBeenCalledTimes(1)
      await act(async () => renameGate.resolve())
      await within(shortcuts).findByText('보고서')
    })

    it('a failed rename keeps the edit box with what was typed', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })
      await enterEdit(user, shortcuts)
      backend.shortcuts.rename.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })

      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      const input = within(shortcuts).getByLabelText(t.renameLabel('A 문서'))
      await user.clear(input)
      await user.type(input, '고친 이름{Enter}')

      expect((await within(shortcuts).findByRole('alert')).textContent).toContain(ko.tasks.errors.internal)
      expect((within(shortcuts).getByLabelText(t.renameLabel('A 문서')) as HTMLInputElement).value).toBe('고친 이름')
      expect(backend.shortcutRepo.list()[0].label).toBe('A 문서')
    })
  })

  describe('S1-05 a failed list is not an empty list', () => {
    it('shows the failure and a retry instead of the empty state; retry loads the list', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      backend.shortcuts.list.mockResolvedValueOnce({ ok: false, error: { code: 'db_unavailable' } } as IpcResult<never>)
      const shortcuts = await card()

      expect(await within(shortcuts).findByText(t.loadFailed)).toBeTruthy()
      expect(within(shortcuts).queryByText(t.empty)).toBeNull()

      await user.click(within(shortcuts).getByRole('button', { name: t.retry }))
      expect(await within(shortcuts).findByRole('button', { name: 'A 문서' })).toBeTruthy()
      expect(within(shortcuts).queryByText(t.loadFailed)).toBeNull()
    })

    it('a thrown list call is reported the same way', async () => {
      const backend = prepare()
      backend.shortcuts.list.mockRejectedValueOnce(new Error('gone'))
      const shortcuts = await card()

      expect(await within(shortcuts).findByText(t.loadFailed)).toBeTruthy()
      expect(within(shortcuts).queryByText(t.empty)).toBeNull()
    })

    it('a failed re-read keeps the shortcuts already shown and says it could not refresh', async () => {
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })

      backend.shortcuts.list.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })
      await act(async () => notifyDataChanged())

      expect(await within(shortcuts).findByText(t.loadFailed)).toBeTruthy()
      expect(within(shortcuts).getByRole('button', { name: 'A 문서' })).toBeTruthy()
    })
  })

  describe('S1-08 long names, small cards, keyboard', () => {
    it('the full name and target stay readable and the name wraps instead of being cut', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const long = '아주긴바로가기이름_'.repeat(10) // 띄어쓰기 없는 100자(저장 최대)
      const longUrl = `https://example.com/${'x'.repeat(300)}`
      backend.shortcutRepo.createUrl({ url: longUrl, label: long })
      const shortcuts = await card()

      const tile = await within(shortcuts).findByRole('button', { name: long })
      expect(tile.getAttribute('title')).toBe(longUrl)
      const name = within(tile).getByText(long)
      expect(name.getAttribute('title')).toBe(long)
      expect(name.className).toContain('[overflow-wrap:anywhere]')
      expect(tile.className).toContain('min-w-0')

      await enterEdit(user, shortcuts)
      const editName = within(shortcuts).getByText(long)
      expect(editName.className).not.toContain('truncate')
      expect(editName.className).toContain('[overflow-wrap:anywhere]')
      // 편집 버튼은 줄바꿈되어 항상 보인다
      expect(within(shortcuts).getByRole('button', { name: t.remove })).toBeTruthy()
    })

    it('tiles are reachable with Tab and open with Enter', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      const [link] = seed(backend)
      const shortcuts = await card()
      const first = await within(shortcuts).findByRole('button', { name: 'A 문서' })

      first.focus()
      await user.keyboard('{Enter}')
      await waitFor(() => expect(backend.shortcuts.open).toHaveBeenCalledWith(link.id))
      await user.tab()
      expect(document.activeElement).toBe(within(shortcuts).getByRole('button', { name: 'report.pdf' }))
    })
  })

  describe('drafts survive data change events', () => {
    it('a link being typed and a rename in progress stay after another screen changes data', async () => {
      const user = userEvent.setup()
      const backend = prepare()
      seed(backend)
      const shortcuts = await card()
      await within(shortcuts).findByRole('button', { name: 'A 문서' })

      await user.click(within(shortcuts).getByRole('button', { name: t.add }))
      await user.click(within(shortcuts).getByRole('button', { name: t.addLink }))
      await user.type(within(shortcuts).getByLabelText(t.urlLabel), 'https://draft.example')
      await act(async () => notifyDataChanged())
      await waitFor(() => expect(backend.shortcuts.list.mock.calls.length).toBeGreaterThanOrEqual(2))
      expect((within(shortcuts).getByLabelText(t.urlLabel) as HTMLInputElement).value).toBe('https://draft.example')
      await user.click(within(shortcuts).getByRole('button', { name: t.cancel }))

      await enterEdit(user, shortcuts)
      await user.click(within(shortcuts).getAllByRole('button', { name: t.rename })[0])
      await user.type(within(shortcuts).getByLabelText(t.renameLabel('A 문서')), ' 초안')
      await act(async () => notifyDataChanged())
      expect((within(shortcuts).getByLabelText(t.renameLabel('A 문서')) as HTMLInputElement).value).toBe('A 문서 초안')
    })
  })
})

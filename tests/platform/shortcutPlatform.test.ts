import { describe, expect, it, vi, type Mock } from 'vitest'
import { createShortcutPlatform, type ShortcutPlatformDeps } from '../../src/main/platform/shortcutPlatform'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Mock<(...args: any[]) => any>

interface Mocks {
  shell: { openExternal: Loose; openPath: Loose }
  dialog: { showOpenDialog: Loose; showMessageBox: Loose }
  getWindow: Loose
  pathExists: Loose
}

function fakeDeps(overrides: Partial<ShortcutPlatformDeps> = {}) {
  const win = { id: 7 } as never
  const deps = {
    shell: {
      openExternal: vi.fn(async () => {}),
      openPath: vi.fn(async () => '')
    },
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/picked/file.txt'] })),
      showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false }))
    },
    getWindow: vi.fn(() => win),
    pathExists: vi.fn(() => true),
    ...overrides
  }
  return { deps: deps as unknown as ShortcutPlatformDeps, mocks: deps as unknown as Mocks, win }
}

describe('shortcut platform (electron adapter)', () => {
  describe('openExternal', () => {
    it('hands an http(s) address to the shell', async () => {
      const { deps, mocks } = fakeDeps()

      await createShortcutPlatform(deps).openExternal('https://example.com/a')

      expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://example.com/a')
    })

    it('refuses everything else, even if called directly', async () => {
      const { deps, mocks } = fakeDeps()
      const platform = createShortcutPlatform(deps)

      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'C:/Windows/System32/calc.exe', 'ms-msdt:/id', 'data:text/html,x', '']) {
        await expect(platform.openExternal(url), url).rejects.toThrow()
      }
      expect(mocks.shell.openExternal).not.toHaveBeenCalled()
    })
  })

  describe('openPath / pathExists', () => {
    it('pass straight through to the shell and the file system check', async () => {
      const { deps, mocks } = fakeDeps()
      mocks.shell.openPath.mockResolvedValueOnce('some error')
      const platform = createShortcutPlatform(deps)

      expect(await platform.openPath('/a/b.txt')).toBe('some error')
      expect(mocks.shell.openPath).toHaveBeenCalledWith('/a/b.txt')
      expect(platform.pathExists('/a/b.txt')).toBe(true)
      expect(mocks.pathExists).toHaveBeenCalledWith('/a/b.txt')
    })
  })

  describe('pickPath', () => {
    it('opens a file chooser attached to the window and returns the picked path', async () => {
      const { deps, mocks, win } = fakeDeps()

      const picked = await createShortcutPlatform(deps).pickPath('file')

      expect(picked).toBe('/picked/file.txt')
      expect(mocks.dialog.showOpenDialog).toHaveBeenCalledTimes(1)
      const [parent, options] = mocks.dialog.showOpenDialog.mock.calls[0] as unknown as [unknown, { properties: string[] }]
      expect(parent).toBe(win)
      expect(options.properties).toEqual(['openFile'])
    })

    it('a folder chooser asks for a directory', async () => {
      const { deps, mocks } = fakeDeps()

      await createShortcutPlatform(deps).pickPath('folder')

      const [, options] = mocks.dialog.showOpenDialog.mock.calls[0] as unknown as [unknown, { properties: string[] }]
      expect(options.properties).toEqual(['openDirectory'])
    })

    it('returns null when cancelled or nothing was chosen', async () => {
      const { deps, mocks } = fakeDeps()
      const platform = createShortcutPlatform(deps)

      mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
      expect(await platform.pickPath('file')).toBeNull()
      mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
      expect(await platform.pickPath('file')).toBeNull()
      mocks.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/should/not/count'] })
      expect(await platform.pickPath('file')).toBeNull()
    })

    it('works without a window too', async () => {
      const { deps, mocks } = fakeDeps({ getWindow: () => null })

      expect(await createShortcutPlatform(deps).pickPath('file')).toBe('/picked/file.txt')

      expect(mocks.dialog.showOpenDialog.mock.calls[0]).toHaveLength(1) // 창 없이 옵션만
    })
  })

  describe('confirmRunExecutable', () => {
    it('shows a warning that names the program and the path, with "cancel" as the default', async () => {
      const { deps, mocks, win } = fakeDeps()

      await createShortcutPlatform(deps).confirmRunExecutable({ label: '내 도구', path: '/tools/run.sh' })

      const [parent, options] = mocks.dialog.showMessageBox.mock.calls[0] as unknown as [
        unknown,
        { type: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }
      ]
      expect(parent).toBe(win)
      expect(options.type).toBe('warning')
      expect(options.message).toContain('내 도구')
      expect(options.detail).toBe('/tools/run.sh')
      expect(options.buttons).toHaveLength(2)
      expect(options.defaultId).toBe(1) // Enter 를 눌러도 취소
      expect(options.cancelId).toBe(1) // Esc·창 닫기도 취소
    })

    it('is true only for the first ("open") button', async () => {
      const { deps, mocks } = fakeDeps()
      const platform = createShortcutPlatform(deps)

      mocks.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
      expect(await platform.confirmRunExecutable({ label: 'x', path: '/x.sh' })).toBe(true)
      mocks.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
      expect(await platform.confirmRunExecutable({ label: 'x', path: '/x.sh' })).toBe(false)
    })
  })
})

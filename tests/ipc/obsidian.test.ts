import { describe, expect, it, vi } from 'vitest'
import type { ObsidianArm } from '../../src/main/arms/obsidian/arm'
import { ArmError } from '../../src/main/arms/sdk/types'
import { createObsidianHandlers, registerObsidianHandlers } from '../../src/main/ipc/obsidian'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_OBSIDIAN_CONFIG, type ObsidianState } from '../../src/shared/obsidian/types'

const state = (): ObsidianState => ({
  status: { state: 'on' },
  available: true,
  config: { ...DEFAULT_OBSIDIAN_CONFIG, vaultPath: '/vault' },
  vaultName: 'vault',
  looksLikeVault: true,
  lastExportAt: null,
  lastExportError: null,
  dailyProblem: null,
  git: null,
  preview: '내용'
})

function setup(overrides: Partial<ObsidianArm> = {}, none = false) {
  const arm = {
    getState: vi.fn(async () => state()),
    setConfig: vi.fn(async () => state()),
    changeVault: vi.fn(async () => state()),
    exportNow: vi.fn(async () => state()),
    fixGitignore: vi.fn(async () => state()),
    openTarget: vi.fn(async () => {}),
    ...overrides
  } as unknown as ObsidianArm
  const logged: unknown[] = []
  const handlers = createObsidianHandlers({ getArm: () => (none ? null : arm), logError: (_c, e) => void logged.push(e) })
  return { arm, handlers, logged }
}

describe('obsidian IPC handlers', () => {
  it('state / exportNow / changeVault / fixGitignore / open pass through to the arm (no arguments are accepted)', async () => {
    const { arm, handlers } = setup()
    expect(await handlers.state()).toMatchObject({ ok: true, data: { vaultName: 'vault' } })
    expect(await handlers.exportNow()).toMatchObject({ ok: true })
    expect(await handlers.changeVault()).toMatchObject({ ok: true })
    expect(await handlers.fixGitignore()).toMatchObject({ ok: true })
    expect(await handlers.open()).toEqual({ ok: true, data: null })
    expect(arm.changeVault).toHaveBeenCalledWith()
    expect(arm.openTarget).toHaveBeenCalledWith()
  })

  it('setConfig accepts only mode, file and dailyNote with valid values — never a vault path', async () => {
    const { arm, handlers } = setup()
    expect(await handlers.setConfig({ mode: 'both', file: 'Octopus\\할 일.md', dailyNote: true })).toMatchObject({ ok: true })
    expect(arm.setConfig).toHaveBeenCalledWith({ mode: 'both', file: 'Octopus/할 일.md', dailyNote: true })

    for (const bad of [{}, null, 'x', { vaultPath: 'C:\\Users' }, { mode: 'all' }, { file: '../x.md' }, { file: '/abs.md' }, { file: 'C:\\x.md' }, { file: 'a.txt' }, { dailyNote: 'yes' }, { mode: 'off', extra: 1 }]) {
      expect(await handlers.setConfig(bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    }
    expect(arm.setConfig).toHaveBeenCalledTimes(1)
  })

  it('a problem the user can fix (ArmError) is invalid_input; anything else is internal without details', async () => {
    const a = setup({ setConfig: vi.fn(async () => { throw new ArmError('경로가 올바르지 않아요') }) })
    expect(await a.handlers.setConfig({ file: 'x.md' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    const b = setup({ exportNow: vi.fn(async () => { throw new Error('C:\\secret\\path') }) })
    const r = await b.handlers.exportNow()
    expect(r).toEqual({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(b.logged).toHaveLength(1)
  })

  it('without the arm every channel answers not_found', async () => {
    const { handlers } = setup({}, true)
    expect(await handlers.state()).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await handlers.open()).toEqual({ ok: false, error: { code: 'not_found' } })
  })

  it('registers exactly the six obsidian channels', () => {
    const handle = vi.fn()
    registerObsidianHandlers({ handle }, setup().handlers)
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual(
      [IPC.obsidianState, IPC.obsidianSetConfig, IPC.obsidianChangeVault, IPC.obsidianExportNow, IPC.obsidianFixGitignore, IPC.obsidianOpen].sort()
    )
  })
})

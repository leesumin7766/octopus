import { describe, expect, it } from 'vitest'
import { buildWebPreferences } from '../src/shared/securityOptions'

describe('buildWebPreferences', () => {
  it('keeps the window security options fixed', () => {
    const prefs = buildWebPreferences('/app/preload.js')
    expect(prefs).toEqual({
      preload: '/app/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })

  it('adds additionalArguments only when there are some, keeping the security options', () => {
    const prefs = buildWebPreferences('/app/preload.js', ['--x=1'])

    expect(prefs).toEqual({
      preload: '/app/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--x=1']
    })
    expect('additionalArguments' in buildWebPreferences('/app/preload.js', [])).toBe(false)
  })
})

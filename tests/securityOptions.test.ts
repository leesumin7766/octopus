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
})

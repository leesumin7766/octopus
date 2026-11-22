import { describe, expect, it } from 'vitest'
import { cleanElectronEnv } from '../../scripts/devEnv.mjs'

describe('cleanElectronEnv', () => {
  it('removes ELECTRON_RUN_AS_NODE and keeps everything else', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', PATH: '/bin', NODE_ENV: 'development', EMPTY: '' }

    expect(cleanElectronEnv(env)).toEqual({ PATH: '/bin', NODE_ENV: 'development', EMPTY: '' })
  })

  it('matches the name case-insensitively (Windows)', () => {
    expect(cleanElectronEnv({ Electron_Run_As_Node: '1', Path: 'C:\\x' })).toEqual({ Path: 'C:\\x' })
  })

  it('does not modify the original object', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', A: 'b' }
    cleanElectronEnv(env)

    expect(env).toEqual({ ELECTRON_RUN_AS_NODE: '1', A: 'b' })
  })
})

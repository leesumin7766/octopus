import { describe, expect, it } from 'vitest'
import { defaultLayout } from '../../src/shared/home/layout'
import { DEFAULT_PIE_SLOTS } from '../../src/shared/pie/actions'
import { defaultSetting, isSettingKey, parseSetting, readSetting, SETTING_KEYS } from '../../src/shared/settings/schema'

describe('settings schema', () => {
  it('knows its keys and nothing else', () => {
    expect([...SETTING_KEYS]).toEqual(['home.layout', 'nav.collapsed', 'pie.slots', 'command.models', 'command.model', 'arms.connected', 'arms.autoAccept', 'mcp.servers', 'mcp.approvals'])
    for (const key of SETTING_KEYS) expect(isSettingKey(key)).toBe(true)
    for (const value of ['home', 'nav', '', 'HOME.LAYOUT', 'constructor', '__proto__', 5, null, undefined, {}]) {
      expect(isSettingKey(value)).toBe(false)
    }
  })

  it('has a default for each key', () => {
    expect(defaultSetting('home.layout')).toEqual(defaultLayout())
    expect(defaultSetting('nav.collapsed')).toBe(false)
    expect(defaultSetting('pie.slots')).toEqual([...DEFAULT_PIE_SLOTS])
  })

  it('pie.slots: eight known actions, otherwise rejected on save and the default on read', () => {
    const custom = [...DEFAULT_PIE_SLOTS.slice(0, 7), 'nav:settings']

    expect(parseSetting('pie.slots', custom)).toEqual(custom)
    for (const value of [DEFAULT_PIE_SLOTS.slice(0, 7), [...custom.slice(0, 7), 'nav:nowhere'], 'command', null, {}]) {
      expect(parseSetting('pie.slots', value)).toBeNull()
      expect(readSetting('pie.slots', value)).toEqual([...DEFAULT_PIE_SLOTS])
    }
    expect(readSetting('pie.slots', custom)).toEqual(custom)
  })

  it('parseSetting accepts the right shape only', () => {
    expect(parseSetting('nav.collapsed', true)).toBe(true)
    expect(parseSetting('nav.collapsed', false)).toBe(false)
    for (const value of ['true', 1, 0, null, undefined, {}, []]) expect(parseSetting('nav.collapsed', value)).toBeNull()

    expect(parseSetting('home.layout', defaultLayout())).toEqual(defaultLayout())
    for (const value of ['x', 1, null, {}, { version: 1 }]) expect(parseSetting('home.layout', value)).toBeNull()
  })

  it('readSetting turns a broken stored value into the default', () => {
    expect(readSetting('nav.collapsed', true)).toBe(true)
    expect(readSetting('nav.collapsed', 'yes')).toBe(false)
    expect(readSetting('nav.collapsed', undefined)).toBe(false)
    expect(readSetting('home.layout', { nope: 1 })).toEqual(defaultLayout())
    expect(readSetting('home.layout', undefined)).toEqual(defaultLayout())
  })
})

import { describe, expect, it } from 'vitest'
import { defaultLayout } from '../../src/shared/home/layout'
import { defaultSetting, isSettingKey, parseSetting, readSetting, SETTING_KEYS } from '../../src/shared/settings/schema'

describe('settings schema', () => {
  it('knows its keys and nothing else', () => {
    expect([...SETTING_KEYS]).toEqual(['home.layout', 'nav.collapsed'])
    for (const key of SETTING_KEYS) expect(isSettingKey(key)).toBe(true)
    for (const value of ['home', 'nav', '', 'HOME.LAYOUT', 'constructor', '__proto__', 5, null, undefined, {}]) {
      expect(isSettingKey(value)).toBe(false)
    }
  })

  it('has a default for each key', () => {
    expect(defaultSetting('home.layout')).toEqual(defaultLayout())
    expect(defaultSetting('nav.collapsed')).toBe(false)
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

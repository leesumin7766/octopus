import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/core/db/migrate'
import { migrations } from '../../src/main/core/db/migrations'
import { createSettingsRepository, type SettingsRepository } from '../../src/main/core/settings/settingsRepository'
import { defaultLayout, moveCard, setCol } from '../../src/shared/home/layout'
import { SettingsValidationError } from '../../src/shared/validation/settings'

describe('settings repository (app_meta)', () => {
  let db: DatabaseSync
  let repo: SettingsRepository

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db, migrations)
    repo = createSettingsRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  const stored = (key: string) => db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined

  it('returns the defaults when nothing was saved', () => {
    expect(repo.get('nav.collapsed')).toBe(false)
    expect(repo.get('home.layout')).toEqual(defaultLayout())
  })

  it('saves and reads back, and the next call sees the same value (survives a "restart")', () => {
    const layout = setCol(moveCard(defaultLayout(), 'todo', 'right'), 65)

    expect(repo.set('nav.collapsed', true)).toBe(true)
    expect(repo.set('home.layout', layout)).toEqual(layout)

    const afterRestart = createSettingsRepository(db)
    expect(afterRestart.get('nav.collapsed')).toBe(true)
    expect(afterRestart.get('home.layout')).toEqual(layout)
  })

  it('overwrites an earlier value instead of adding a row', () => {
    repo.set('nav.collapsed', true)
    repo.set('nav.collapsed', false)

    expect(repo.get('nav.collapsed')).toBe(false)
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key = 'settings.nav.collapsed'").get()).toEqual({ n: 1 })
  })

  it('stores under a "settings." prefix and leaves other app_meta rows alone', () => {
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_note', 'keep me')").run()

    repo.set('nav.collapsed', true)

    expect(stored('settings.nav.collapsed')).toEqual({ value: 'true' })
    expect(stored('schema_note')).toEqual({ value: 'keep me' })
    expect(stored('nav.collapsed')).toBeUndefined()
  })

  it('clamps out-of-range ratios on save and returns what was stored', () => {
    const saved = repo.set('home.layout', { ...defaultLayout(), col: 10, row: 90 })

    expect(saved).toMatchObject({ col: 25, row: 75 })
    expect(repo.get('home.layout')).toMatchObject({ col: 25, row: 75 })
  })

  it('refuses a wrong value or an unknown key, saving nothing', () => {
    expect(() => repo.set('nav.collapsed', 'yes')).toThrow(SettingsValidationError)
    expect(() => repo.set('home.layout', { version: 1 })).toThrow(SettingsValidationError)
    expect(() => repo.set('home.unknown' as never, true)).toThrow(SettingsValidationError)
    expect(db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key LIKE 'settings.%'").get()).toEqual({ n: 0 })
  })

  it('reports which part is wrong', () => {
    try {
      repo.set('nav.collapsed', 5)
      expect.unreachable()
    } catch (error) {
      expect((error as SettingsValidationError).issues.map((i) => i.field)).toEqual(['value'])
    }
    try {
      repo.set('nope' as never, true)
      expect.unreachable()
    } catch (error) {
      expect((error as SettingsValidationError).issues.map((i) => i.field)).toEqual(['key'])
    }
  })

  it('falls back to the default when the stored text is broken', () => {
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('settings.home.layout', '{not json')").run()
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('settings.nav.collapsed', '\"yes\"')").run()

    expect(repo.get('home.layout')).toEqual(defaultLayout())
    expect(repo.get('nav.collapsed')).toBe(false)
  })

  it('falls back to the default when the stored layout lost a card', () => {
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('settings.home.layout', ?)").run(
      JSON.stringify({ version: 1, order: ['todo', 'calendar', 'memo'], col: 40, row: 40 })
    )

    expect(repo.get('home.layout')).toEqual(defaultLayout())
  })
})

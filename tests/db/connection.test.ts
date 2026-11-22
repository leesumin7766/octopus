import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/core/db/connection'

describe('openDatabase', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'octopus-db-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('opens a file database with WAL and foreign keys on', () => {
    const db = openDatabase(join(dir, 'nested', 'octopus.db'))
    try {
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    } finally {
      db.close()
    }
  })
})

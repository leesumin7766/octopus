import type { Migration } from '../migrate'

export const migration001: Migration = {
  version: 1,
  name: 'app_meta',
  up(db) {
    db.exec('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  }
}

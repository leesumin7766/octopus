import { app, BrowserWindow, ipcMain } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { ko } from '../renderer/i18n/ko'
import { IPC } from '../shared/ipc'
import { buildWebPreferences } from '../shared/securityOptions'
import { openDatabase } from './core/db/connection'
import { runMigrations } from './core/db/migrate'
import { migrations } from './core/db/migrations'

let database: DatabaseSync | null = null

function initDatabase(): void {
  try {
    const db = openDatabase(join(app.getPath('userData'), 'octopus.db'))
    try {
      runMigrations(db, migrations)
    } catch (error) {
      db.close()
      throw error
    }
    database = db
  } catch (error) {
    // 아직 화면에는 보여 주지 않는다. 로그만 남기고 앱은 계속 뜬다.
    console.error(`[octopus] ${ko.dbOpenFailed}`, error)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    title: ko.appTitle,
    webPreferences: buildWebPreferences(join(__dirname, '../preload/index.js'))
  })

  win.webContents.on('did-finish-load', () => {
    console.log('[octopus] window loaded')
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  initDatabase()
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  database?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

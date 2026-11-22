import { app, BrowserWindow, ipcMain } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { buildWebPreferences } from '../shared/securityOptions'
import { openDatabase } from './core/db/connection'
import { runMigrations } from './core/db/migrate'
import { migrations } from './core/db/migrations'
import { createTaskRepository, type TaskRepository } from './core/tasks/taskRepository'
import { createTaskHandlers, registerTaskHandlers } from './ipc/tasks'

let database: DatabaseSync | null = null
// DB 를 열지 못하면 null 로 남고, 할 일 IPC 는 db_unavailable 을 돌려준다.
let taskRepository: TaskRepository | null = null

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
    taskRepository = createTaskRepository(db, { now: () => new Date() })
  } catch (error) {
    // 아직 화면에는 보여 주지 않는다. 로그만 남기고 앱은 계속 뜬다.
    console.error('[octopus] failed to open the database or run migrations', error)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'Octopus',
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
  registerTaskHandlers(
    ipcMain,
    createTaskHandlers({
      getRepository: () => taskRepository,
      now: () => new Date(),
      logError: (channel, error) => console.error(`[octopus] ${channel} failed`, error)
    })
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  taskRepository = null
  database?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

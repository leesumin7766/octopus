import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { buildWebPreferences } from '../shared/securityOptions'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'Octopus',
    webPreferences: buildWebPreferences(join(__dirname, '../preload/index.js'))
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerIpc, getStreamServer } from './ipc.ts'
import { engineManager } from './engine/manager.ts'
import { installProxyTunnel, removeProxyTunnel } from './net/tunnel.ts'
import { setUserDataDir } from './app-paths.ts'
import { settings } from './settings.ts'
import { library } from './library.ts'

let mainWindow: BrowserWindow | null = null

function resolvePreload(): string {
  const candidates = [
    path.join(__dirname, '../preload/index.mjs'),
    path.join(__dirname, '../preload/index.js')
  ]
  return (
    candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate)
      } catch {
        return false
      }
    }) ?? candidates[0]
  )
}

function applyProxy(): void {
  const current = settings.get()
  if (current.proxy.enabled) {
    installProxyTunnel(current.proxy)
  } else {
    removeProxyTunnel()
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0c12',
    title: 'PTM',
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Optional: pause downloads while minimized, resume when restored.
  mainWindow.on('minimize', () => {
    if (settings.get().pauseWhenMinimized) void engineManager.setAllPaused(true)
  })
  mainWindow.on('restore', () => {
    if (settings.get().pauseWhenMinimized) void engineManager.setAllPaused(false)
  })
}

// Keep a single instance: two copies would fight over the torrent ports and
// the same download directory.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    setUserDataDir(app.getPath('userData'))
    applyProxy()
    settings.onChange(applyProxy)
    engineManager.use(settings.get().engine)

    await getStreamServer().start()
    registerIpc(() => mainWindow)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  // Flush stores and stop the engines before the process exits. Guarded
  // against re-entry because we re-invoke app.quit() once cleanup is done.
  if (quitting) return
  quitting = true
  event.preventDefault()
  void (async () => {
    settings.flush()
    library.flush()
    try {
      await engineManager.destroy()
    } catch (error) {
      console.error('[app] engine shutdown failed', (error as Error).message)
    }
    getStreamServer().stop()
    app.quit()
  })()
})

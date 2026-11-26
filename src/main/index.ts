import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerIpc, getStreamServer } from './ipc.ts'
import { engineManager } from './engine/manager.ts'
import { installProxyTunnel, removeProxyTunnel } from './net/tunnel.ts'
import { setUserDataDir } from './app-paths.ts'
import { settings } from './settings.ts'
import { library } from './library.ts'
import { downloads } from './downloads.ts'

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

/**
 * Re-add torrents that were in flight when the app last closed. Items that
 * were paused are re-paused once added; error items are retried too — the
 * engine treats them as fresh attempts and surfaces failures as usual.
 */
function resumeIncompleteDownloads(): void {
  const pending = downloads
    .list()
    .filter(
      (item) =>
        item.infoHash &&
        (item.status === 'downloading' || item.status === 'paused' || item.status === 'error')
    )
  if (pending.length === 0) return

  console.log(`[resume] re-adding ${pending.length} incomplete download(s)`)
  for (const item of pending) {
    const magnet = `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.name)}`
    engineManager
      .add({ magnet, title: item.name, infoHash: item.infoHash })
      .then(async (session) => {
        downloads.trackAdd({ magnet, infoHash: item.infoHash, title: item.name, sessionId: session.id })
        if (item.status === 'paused') {
          try {
            await engineManager.setPaused(session.id, true)
          } catch (error) {
            console.warn('[resume] could not re-pause', item.infoHash, (error as Error).message)
          }
        }
      })
      .catch((error) => {
        console.warn('[resume] could not re-add', item.infoHash, (error as Error).message)
      })
  }
}

/**
 * Auto-update only engages when a publish destination ships inside the
 * installer (electron-builder's `publish` key — see electron-builder.yml).
 * Without one, checkForUpdatesAndNotify rejects and this does nothing.
 */
function checkForUpdates(): void {
  void import('electron-updater')
    .then(({ autoUpdater }) => {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.on('error', (error) => {
        console.warn('[update] check failed', (error as Error).message)
      })
      autoUpdater.on('update-downloaded', (info) => {
        console.log(`[update] ${info.version} downloaded — installs on restart`)
      })
      return autoUpdater.checkForUpdatesAndNotify()
    })
    .catch(() => undefined)
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

  // Never let the window navigate away from the app itself; openExternal
  // above is the only way out for new content. The initial load (dev server
  // or the bundled file) is allowed through.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    const allowed =
      (devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!allowed) event.preventDefault()
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

    await getStreamServer().start()
    registerIpc(() => mainWindow)
    resumeIncompleteDownloads()

    createWindow()
    checkForUpdates()

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
    downloads.flush()
    try {
      await engineManager.destroy()
    } catch (error) {
      console.error('[app] engine shutdown failed', (error as Error).message)
    }
    getStreamServer().stop()
    app.quit()
  })()
})

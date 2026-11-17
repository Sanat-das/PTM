import { createRequire } from 'node:module'

let userDataDir = ''

/** Explicitly pin the data directory. Used by tests, and by the app at startup. */
export function setUserDataDir(dir: string): void {
  userDataDir = dir
}

/**
 * Electron's userData path, resolved lazily so that modules importing the
 * settings store stay loadable outside Electron (tests, scripts).
 */
export function getUserDataDir(): string {
  if (userDataDir) return userDataDir
  const require = createRequire(import.meta.url)
  const { app } = require('electron') as typeof import('electron')
  userDataDir = app.getPath('userData')
  return userDataDir
}

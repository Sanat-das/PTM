/**
 * Renders build/icon.svg into build/icon-1024.png using Electron's Chromium
 * (the project already ships Electron, so no image tooling is needed).
 *
 * Usage: npx electron scripts/render-icon.mjs
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(root, 'build', 'icon.svg')
const outPath = path.join(root, 'build', 'icon-1024.png')

const svg = fs.readFileSync(svgPath, 'utf8')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: 1024px; height: 1024px; }
</style></head><body>${svg}</body></html>`

const tmpHtml = path.join(root, 'build', '.icon.render.html')
fs.writeFileSync(tmpHtml, html, 'utf8')

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    frame: false,
    transparent: true,
    webPreferences: { backgroundThrottling: false }
  })
  try {
    await window.loadFile(tmpHtml)
    // Let the SVG settle (fonts are irrelevant here, one frame is enough).
    await new Promise((resolve) => setTimeout(resolve, 250))
    const image = await window.webContents.capturePage()
    if (image.isEmpty()) throw new Error('capturePage returned an empty image')
    fs.writeFileSync(outPath, image.toPNG())
    console.log('[render-icon] wrote', outPath)
  } finally {
    window.destroy()
    fs.rmSync(tmpHtml, { force: true })
    app.quit()
  }
})

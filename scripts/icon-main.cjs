// 임시 앱 아이콘을 만드는 Electron main 스크립트(외부 다운로드 없음): 파란 원 + 문어 선 그림을 렌더링해 build/icon.png, build/icon.ico 로 저장한다.
// 사용: node scripts/make-icons.mjs  (나중에 진짜 아이콘으로 바꾸면 이 스크립트는 필요 없다)
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 1024
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="48" fill="#3346C8"/>
  <g transform="translate(50 52) scale(2.5) translate(-14 -14.5)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round">
    <path d="M7 13a7 7 0 0 1 14 0v3"/>
    <path d="M7 15c0 3-2 4-3 6"/>
    <path d="M11 16c0 3-1 5-2 7"/>
    <path d="M17 16c0 3 1 5 2 7"/>
    <path d="M21 15c0 3 2 4 3 6"/>
  </g>
</svg>`
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const out = join(__dirname, '..', 'build')
  mkdirSync(out, { recursive: true })
  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;background:transparent">${SVG}</body>`))
  await new Promise((resolve) => setTimeout(resolve, 600))
  const image = await win.webContents.capturePage()
  const base = image.getSize().width === SIZE ? image : image.resize({ width: SIZE, height: SIZE, quality: 'best' })
  writeFileSync(join(out, 'icon.png'), base.toPNG())

  // ICO: PNG 로 압축된 크기별 그림을 한 파일에 담는다(Windows Vista 이상).
  const pngs = ICO_SIZES.map((size) => ({ size, data: base.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + pngs.length * 16
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit depth
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]))
  console.log('icons written to', out)
  app.quit()
})

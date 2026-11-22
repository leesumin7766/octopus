// @ts-check
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cleanElectronEnv } from './devEnv.mjs'

// .cmd 래퍼나 셸을 거치지 않도록 electron-vite 의 JS 진입점을 현재 node 로 직접 실행한다.
const require = createRequire(import.meta.url)
const pkgPath = require.resolve('electron-vite/package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const bin = join(dirname(pkgPath), pkg.bin['electron-vite'])

const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: cleanElectronEnv(process.env)
})

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})

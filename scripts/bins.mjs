// @ts-check
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** electron-vite 의 JS 진입점. .cmd 래퍼나 셸을 거치지 않고 node 로 직접 실행한다. */
export function electronViteBin() {
  const pkgPath = require.resolve('electron-vite/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  return join(dirname(pkgPath), pkg.bin['electron-vite'])
}

/** 설치된 electron 실행 파일 경로 */
export function electronBin() {
  /** @type {string} */
  const path = require('electron')
  return path
}

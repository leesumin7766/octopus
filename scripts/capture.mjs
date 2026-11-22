// @ts-check
// 개발용 화면 캡처: 빌드한 앱을 보기별로 한 번씩 띄워 .captures/<view>.png 를 만든다.
// 사용: npm run capture            (빌드 후 캡처)
//       npm run capture -- --no-build   (이미 빌드했을 때)
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBin, electronViteBin } from './bins.mjs'
import { cleanElectronEnv } from './devEnv.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.captures')
// [처음 화면, 저장할 파일 이름]
const SHOTS = [
  ['home', 'home'],
  ['home-arrange', 'home-layout'],
  ['today', 'today'],
  ['routines', 'routines'],
  ['memos', 'memos']
]
const TIMEOUT_MS = 60_000
const TEMP_PREFIX = 'octopus-capture-'

/** 앱이 만든 임시 userData 폴더 이름들 */
function tempDirs() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)))
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>} 종료 코드
 */
function run(command, args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolveRun(code ?? 1)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolveRun(1)
    })
  })
}

// ELECTRON_RUN_AS_NODE 가 켜진 셸에서도 창이 뜨도록 지운 환경에서 실행한다.
const baseEnv = cleanElectronEnv(process.env)

if (!process.argv.includes('--no-build')) {
  const code = await run(process.execPath, [electronViteBin(), 'build'], baseEnv)
  if (code !== 0) {
    console.error('capture: build failed')
    process.exit(code)
  }
}

mkdirSync(outDir, { recursive: true })
let failed = false

for (const [view, name] of SHOTS) {
  const output = join(outDir, `${name}.png`)
  rmSync(output, { force: true }) // 예전 파일이 남아 성공처럼 보이지 않게

  const before = tempDirs()
  const code = await run(electronBin(), ['.'], { ...baseEnv, OCTOPUS_CAPTURE: output, OCTOPUS_CAPTURE_VIEW: view })
  // 앱이 끝난 뒤에야 파일 잠금이 풀리므로, 이번 실행이 만든 임시 userData 는 여기서 지운다.
  for (const name of tempDirs()) {
    if (!before.has(name)) rmSync(join(tmpdir(), name), { recursive: true, force: true })
  }

  let size = 0
  try {
    size = statSync(output).size
  } catch {
    // 파일이 없음
  }
  if (code !== 0 || size === 0) {
    console.error(`capture: ${name} failed (exit ${code}, ${size} bytes)`)
    failed = true
  } else {
    console.log(`capture: ${name} -> ${output} (${size} bytes)`)
  }
}

process.exit(failed ? 1 : 0)

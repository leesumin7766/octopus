// @ts-check
import { spawn } from 'node:child_process'
import { electronViteBin } from './bins.mjs'
import { cleanElectronEnv } from './devEnv.mjs'

// --watch: main·preload 코드가 바뀌면 앱을 다시 시작한다(화면만 새로 바뀌어 main 과 어긋나는 일을 막는다).

const child = spawn(process.execPath, [electronViteBin(), 'dev', '--watch', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: cleanElectronEnv(process.env)
})

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})

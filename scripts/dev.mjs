// @ts-check
import { spawn } from 'node:child_process'
import { electronViteBin } from './bins.mjs'
import { cleanElectronEnv } from './devEnv.mjs'

const child = spawn(process.execPath, [electronViteBin(), 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: cleanElectronEnv(process.env)
})

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})

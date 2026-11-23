// @ts-check
// 임시 앱 아이콘(build/icon.png, build/icon.ico)을 만든다. 결과 파일은 저장소에 들어 있으므로 아이콘을 바꿀 때만 다시 실행한다.
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronBin } from './bins.mjs'
import { cleanElectronEnv } from './devEnv.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(electronBin(), [join(root, 'scripts', 'icon-main.cjs')], { cwd: root, env: cleanElectronEnv(process.env), stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))

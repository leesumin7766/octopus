import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 의존 방향 검사(CLAUDE.md 절대 원칙 3): src/main/core 는 arms 를 import 하지 않는다.
// 소스 파일의 import 문을 읽어서, core 아래 파일이 arms 폴더를 가리키면 실패한다.

const ROOT = resolve(__dirname, '../..')
const CORE = join(ROOT, 'src/main/core')
const ARMS = join(ROOT, 'src/main/arms')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** import/export from 'x', import('x'), require('x') 의 x 들 */
function specifiers(source: string): string[] {
  const out: string[] = []
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm
  for (const match of source.matchAll(pattern)) out.push(match[1])
  return out
}

function pointsIntoArms(file: string, specifier: string): boolean {
  if (/(^|\/)arms(\/|$)/.test(specifier) && !specifier.startsWith('node:')) {
    if (!specifier.startsWith('.')) return true // 별칭 경로 'arms/...'
  }
  if (!specifier.startsWith('.')) return false
  const target = resolve(file, '..', specifier)
  return target === ARMS || target.startsWith(ARMS + '\\') || target.startsWith(ARMS + '/')
}

describe('dependency direction', () => {
  const files = sourceFiles(CORE)

  it('finds the core sources it is supposed to check', () => {
    expect(files.length).toBeGreaterThan(15)
  })

  it('no file under src/main/core imports anything from src/main/arms', () => {
    const offenders = files.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((s) => pointsIntoArms(file, s))
        .map((s) => `${relative(ROOT, file)} -> ${s}`)
    )
    expect(offenders).toEqual([])
  })

  it('the checker itself would catch a violation (relative and deep paths)', () => {
    const file = join(CORE, 'tasks/taskRepository.ts')
    expect(pointsIntoArms(file, '../../arms/sdk/manager')).toBe(true)
    expect(pointsIntoArms(file, '../../arms')).toBe(true)
    expect(pointsIntoArms(file, '../../../shared/arms/types')).toBe(false) // shared 는 괜찮다
    expect(pointsIntoArms(file, '../errors')).toBe(false)
    expect(specifiers("import { a } from '../../arms/sdk/manager'\nexport * from \"../../arms\"\nconst x = await import('../../arms/x')")).toEqual([
      '../../arms/sdk/manager',
      '../../arms',
      '../../arms/x'
    ])
  })

  it('shared code does not import main either (it is used by the renderer too)', () => {
    const shared = sourceFiles(join(ROOT, 'src/shared'))
    const offenders = shared.flatMap((file) => specifiers(readFileSync(file, 'utf8')).filter((s) => /\/main\//.test(s)).map((s) => `${relative(ROOT, file)} -> ${s}`))
    expect(offenders).toEqual([])
  })
})

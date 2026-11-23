import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ObsidianGitCheck } from '../../../shared/obsidian/types'
import { atomicWrite, exists } from './vault'

// vault 가 git 저장소이면 옵시디언이 계속 바꾸는 작업 영역 파일이 무시되는지 점검한다. 자동으로 고치지 않는다(사용자 확인 후에만).

export const WORKSPACE_FILES = ['.obsidian/workspace.json', '.obsidian/workspace-mobile.json'] as const
export const IGNORE_LINE = '.obsidian/workspace*.json'

/** git 실행: 종료 코드를 돌려준다. 실행할 수 없으면(git 이 없음 등) null. 인자는 배열로만 넘긴다(셸을 거치지 않는다). */
export type RunGit = (args: string[]) => Promise<number | null>

export const realRunGit: RunGit = (args) =>
  new Promise((resolve) => {
    execFile('git', args, { windowsHide: true, timeout: 10_000 }, (error) => {
      if (!error) return resolve(0)
      const code = (error as NodeJS.ErrnoException & { code?: number | string }).code
      resolve(typeof code === 'number' ? code : null)
    })
  })

// ---- .gitignore 간단 해석(git 이 없을 때) ----

function globToRegex(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** .gitignore 줄들이 relPath(슬래시 구분, vault 기준)를 무시하는지. 부정(!)·폴더 전용(끝의 /)·앞의 / 를 다룬다. */
export function ignoredByGitignore(lines: readonly string[], relPath: string): boolean {
  const segments = relPath.split('/')
  let ignored = false
  for (const raw of lines) {
    let line = raw.replace(/\s+$/, '')
    if (line === '' || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    if (negate) line = line.slice(1)
    const dirOnly = line.endsWith('/')
    if (dirOnly) line = line.slice(0, -1)
    const anchored = line.startsWith('/') || line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    if (line === '') continue
    const re = globToRegex(line)

    let matches = false
    for (let i = 1; i <= segments.length && !matches; i++) {
      const isLast = i === segments.length
      if (dirOnly && isLast) continue // 폴더 전용 패턴은 파일 자체와는 맞지 않는다(상위 폴더로만)
      const prefix = segments.slice(0, i).join('/')
      matches = anchored ? re.test(prefix) : re.test(segments[i - 1])
    }
    if (matches) ignored = !negate
  }
  return ignored
}

export interface GitDeps {
  runGit?: RunGit
}

/** vault 의 git 점검. .git 이 없으면 isGit false. */
export async function checkVaultGit(vault: string, deps: GitDeps = {}): Promise<ObsidianGitCheck> {
  const result: ObsidianGitCheck = { isGit: false, notIgnored: [], line: IGNORE_LINE }
  if (!(await exists(join(vault, '.git')))) return result
  result.isGit = true

  const run = deps.runGit ?? realRunGit
  let gitignoreLines: string[] | null = null
  for (const file of WORKSPACE_FILES) {
    const code = await run(['-C', vault, 'check-ignore', '-q', '--', file])
    let ignored: boolean
    if (code === 0) ignored = true
    else if (code === 1) ignored = false
    else {
      // git 을 쓸 수 없으면(없음·오류) .gitignore 를 간단히 읽어 본다.
      gitignoreLines ??= (await readFile(join(vault, '.gitignore'), 'utf8').catch(() => '')).split(/\r?\n/)
      ignored = ignoredByGitignore(gitignoreLines, file)
    }
    if (!ignored) result.notIgnored.push(file)
  }
  return result
}

/** .gitignore 끝에 한 줄을 더한다(원자적 쓰기). 이미 같은 줄이 있으면 아무것도 하지 않고 false. */
export async function addIgnoreLine(vault: string, line = IGNORE_LINE): Promise<boolean> {
  const path = join(vault, '.gitignore')
  const current = (await exists(path)) ? await readFile(path, 'utf8') : ''
  if (current.split(/\r?\n/).some((l) => l.trim() === line)) return false
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  const prefix = current === '' || current.endsWith('\n') ? current : current + eol
  await atomicWrite(path, `${prefix}${line}${eol}`)
  return true
}

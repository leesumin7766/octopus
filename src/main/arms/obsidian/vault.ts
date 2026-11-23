import { randomBytes } from 'node:crypto'
import { access, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { normalizeExportPath } from '../../../shared/validation/obsidian'

// vault 안의 파일을 안전하게 다루는 도구: 경로가 vault 밖으로 나가지 않게 확인하고, 파일은 임시 파일 + rename 으로 통째로 쓴다.

export class VaultPathError extends Error {
  constructor() {
    super('path is outside the vault or not allowed')
    this.name = 'VaultPathError'
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const inside = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 가장 가까이 있는 기존 상위 폴더의 실제 경로(링크를 푼 것) */
async function realExistingAncestor(path: string): Promise<string> {
  let current = path
  for (;;) {
    try {
      return await realpath(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) throw new VaultPathError()
      current = parent
    }
  }
}

/**
 * vault 기준 상대 경로를 실제 경로로 바꾼다. 거부: 절대 경로·.. ·.md 가 아닌 것·정규화한 뒤 vault 밖,
 * 그리고 바로 가기(심볼릭 링크)를 따라가면 vault 밖으로 나가는 경우.
 */
export async function resolveInsideVault(vault: string, relPath: string): Promise<string> {
  const normalized = normalizeExportPath(relPath)
  if (!normalized) throw new VaultPathError()
  const root = resolve(vault)
  const target = resolve(root, ...normalized.split('/'))
  if (!inside(root, target)) throw new VaultPathError()

  const realRoot = await realpath(root)
  const realParent = await realExistingAncestor(dirname(target))
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) throw new VaultPathError()
  return target
}

/** 파일 하나를 통째로 쓴다: 같은 폴더의 임시 파일에 쓰고 rename. 실패하면 임시 파일을 지우고 다시 던진다. */
export async function atomicWrite(target: string, content: string): Promise<void> {
  const dir = dirname(target)
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `.${basename(target)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 덮어쓰기 전 기존 파일을 backupDir 에 마지막 1개만 남긴다(vault 를 어지럽히지 않는다). 실패해도 던지지 않고 false. */
export async function backupLast(source: string, backupDir: string): Promise<boolean> {
  try {
    await mkdir(backupDir, { recursive: true })
    await copyFile(source, join(backupDir, 'last-export.md'))
    return true
  } catch {
    return false
  }
}

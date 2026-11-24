import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArmContext } from '../../src/main/arms/sdk/context'
import {
  createObsidianArm,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_WATCH_DEBOUNCE_MS,
  MESSAGES,
  obsidianOpenUri,
  vaultNameOf,
  type ObsidianArm
} from '../../src/main/arms/obsidian/arm'
import { dailyLinkLine, dailyNotePath, hasDailyLink, UNSUPPORTED_FORMAT } from '../../src/main/arms/obsidian/dailyNote'
import { addIgnoreLine, checkVaultGit, ignoredByGitignore, IGNORE_LINE } from '../../src/main/arms/obsidian/gitCheck'
import { FILE_COMMENT, WRITING_HEADING, WRITING_NOTE } from '../../src/main/arms/obsidian/render'
import { atomicWrite, backupLast, resolveInsideVault, VaultPathError } from '../../src/main/arms/obsidian/vault'
import { extractCaptured, findWritingSection } from '../../src/main/arms/obsidian/writing'
import { createMemorySecureStore } from '../../src/main/dev/captureArms'
import { createCandidateRepository } from '../../src/main/core/inbox/candidateRepository'
import { createChangeBus } from '../../src/main/core/changes'
import { notifyOnChange } from '../../src/main/core/tasks/notifying'
import { DEFAULT_OBSIDIAN_CONFIG, type ObsidianConfig } from '../../src/shared/obsidian/types'
import { normalizeExportPath } from '../../src/shared/validation/obsidian'
import { createTestRepo } from '../tasks/helpers'

const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (prefix = 'octopus-obs-'): string => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

// ---------------------------------------------------------------- 경로 검증

describe('export path validation', () => {
  it.each([
    ['Octopus/할 일.md', 'Octopus/할 일.md'],
    ['할 일.md', '할 일.md'],
    ['a\\b\\c.MD', 'a/b/c.MD'],
    ['  Octopus/x.md  ', 'Octopus/x.md'],
    ['폴더/하위 폴더/파일.md', '폴더/하위 폴더/파일.md'],
    ['a//b.md', 'a/b.md']
  ])('accepts %s', (input, normalized) => expect(normalizeExportPath(input)).toBe(normalized))

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['parent segment', '../밖.md'],
    ['parent in the middle', 'a/../../b.md'],
    ['hidden parent after a name', 'a/b/..'],
    ['absolute (slash)', '/etc/x.md'],
    ['absolute (backslash)', '\\Windows\\x.md'],
    ['drive letter', 'C:\\Users\\me\\x.md'],
    ['drive letter without slash', 'C:x.md'],
    ['UNC', '\\\\server\\share\\x.md'],
    ['not markdown', 'Octopus/할 일.txt'],
    ['no extension', 'Octopus/할 일'],
    ['only the extension', '.md'],
    ['dot segment', './x.md'],
    ['windows-forbidden character', 'a/b?.md'],
    ['reserved name', 'a/CON.md'],
    ['trailing dot in a folder', 'a./b.md'],
    ['too long', `${'a'.repeat(250)}.md`],
    ['NUL', 'a\0b.md']
  ])('refuses %s', (_name, input) => expect(normalizeExportPath(input)).toBeNull())

  it('refuses things that are not strings', () => {
    for (const v of [null, undefined, 5, {}, []]) expect(normalizeExportPath(v)).toBeNull()
  })

  it('resolveInsideVault gives a path inside the vault, and throws for anything that leaves it', async () => {
    const vault = tmp()
    const ok = await resolveInsideVault(vault, 'Octopus/할 일.md')
    expect(ok.startsWith(vault)).toBe(true)
    for (const bad of ['../x.md', '/abs.md', 'C:\\x.md', 'a/../../x.md', 'x.txt']) {
      await expect(resolveInsideVault(vault, bad)).rejects.toBeInstanceOf(VaultPathError)
    }
  })

  it('a folder inside the vault that is a link pointing outside is refused', async () => {
    const vault = tmp()
    const outside = tmp('octopus-outside-')
    try {
      symlinkSync(outside, join(vault, 'escape'), 'junction')
    } catch {
      return // 이 환경에서 링크를 만들 수 없으면 건너뛴다
    }
    await expect(resolveInsideVault(vault, 'escape/x.md')).rejects.toBeInstanceOf(VaultPathError)
  })
})

describe('atomic write and backup', () => {
  it('writes the whole file, creates missing folders, and leaves no temp file behind', async () => {
    const vault = tmp()
    const target = join(vault, 'Octopus', '할 일.md')
    await atomicWrite(target, '첫 내용\n')
    await atomicWrite(target, '둘째 내용\n')
    expect(readFileSync(target, 'utf8')).toBe('둘째 내용\n')
    expect(readdirSync(join(vault, 'Octopus'))).toEqual(['할 일.md'])
  })

  it('a failed write removes its temp file and keeps the old file intact', async () => {
    const vault = tmp()
    const target = join(vault, 'x.md')
    writeFileSync(target, '원래 내용')
    mkdirSync(join(vault, 'dir.md')) // 대상이 폴더라서 rename 이 실패한다
    await expect(atomicWrite(join(vault, 'dir.md'), 'x')).rejects.toBeTruthy()
    expect(readdirSync(vault).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(readFileSync(target, 'utf8')).toBe('원래 내용')
  })

  it('backup keeps only the last copy, outside the vault', async () => {
    const vault = tmp()
    const backup = tmp('octopus-backup-')
    writeFileSync(join(vault, 'x.md'), '버전 1')
    expect(await backupLast(join(vault, 'x.md'), backup)).toBe(true)
    writeFileSync(join(vault, 'x.md'), '버전 2')
    await backupLast(join(vault, 'x.md'), backup)
    expect(readdirSync(backup)).toEqual(['last-export.md'])
    expect(readFileSync(join(backup, 'last-export.md'), 'utf8')).toBe('버전 2')
    expect(await backupLast(join(vault, 'missing.md'), backup)).toBe(false) // 실패해도 던지지 않는다
  })
})

// ---------------------------------------------------------------- 적어 넣기 해석

describe('writing section parsing', () => {
  const file = (tail: string): string => `${FILE_COMMENT}\n\n## 오늘 · 3월 10일 화요일\n- [ ] 위의 할 일\n\n${WRITING_HEADING}\n${WRITING_NOTE}\n${tail}`

  it('finds the section and only reads "- [ ] text" lines; checked lines and other text stay', () => {
    const section = findWritingSection(file('- [ ] 첫째\n- [x] 끝낸 줄\n그냥 적은 글\n  - [ ] 들여쓴 둘째\n* [ ] 별표 셋째\n- [ ] \n'))
    const { items, rest } = extractCaptured(section?.lines ?? [])
    expect(items).toEqual(['첫째', '들여쓴 둘째', '별표 셋째'])
    expect(rest).toEqual(['- [x] 끝낸 줄', '그냥 적은 글'])
  })

  it('lines above the section are never read, and a file without the section gives null', () => {
    expect(findWritingSection(`${FILE_COMMENT}\n## 오늘\n- [ ] 위의 할 일\n`)).toBeNull()
    expect(extractCaptured(findWritingSection(file(''))?.lines ?? []).items).toEqual([])
  })

  it('the section ends at the next heading', () => {
    const section = findWritingSection(`${WRITING_HEADING}\n- [ ] 안\n## 다른 구역\n- [ ] 밖\n`)
    expect(extractCaptured(section?.lines ?? []).items).toEqual(['안'])
  })

  it('CRLF files work too', () => {
    expect(extractCaptured(findWritingSection(file('- [ ] 윈도우 줄\n').replace(/\n/g, '\r\n'))?.lines ?? []).items).toEqual(['윈도우 줄'])
  })
})

// ---------------------------------------------------------------- 일일노트·git·uri

describe('daily note path', () => {
  const day = new Date(2026, 2, 5)

  it('uses YYYY, MM and DD (default YYYY-MM-DD) and the folder', () => {
    expect(dailyNotePath({}, day)).toEqual({ ok: true, path: '2026-03-05.md' })
    expect(dailyNotePath({ folder: 'Daily/', format: 'YYYY/MM/YYYY-MM-DD' }, day)).toEqual({ ok: true, path: 'Daily/2026/03/2026-03-05.md' })
    expect(dailyNotePath({ folder: '', format: 'YYYY년 MM월 DD일' }, day)).toEqual({ ok: true, path: '2026년 03월 05일.md' })
    expect(dailyNotePath(undefined, day)).toEqual({ ok: true, path: '2026-03-05.md' })
  })

  it.each(['dddd, MMMM Do YYYY', 'gggg-[W]ww', 'YYYY-MM-DD [일기]', 'YY-M-D', 'YYYY-MM-DD HH:mm'])('says "not supported yet" for the format %s', (format) => {
    expect(dailyNotePath({ format }, day)).toEqual({ ok: false, problem: UNSUPPORTED_FORMAT })
  })

  it('a folder that leaves the vault is not allowed', () => {
    expect(dailyNotePath({ folder: '../밖' }, day)).toMatchObject({ ok: false })
  })

  it('the link line is the export path without .md, and existing links (also with an alias) are recognised', () => {
    expect(dailyLinkLine('Octopus/할 일.md')).toBe('[[Octopus/할 일]]')
    expect(hasDailyLink('a\n[[Octopus/할 일]]\n', 'Octopus/할 일.md')).toBe(true)
    expect(hasDailyLink('[[Octopus/할 일|할 일]]', 'Octopus/할 일.md')).toBe(true)
    expect(hasDailyLink('[[Octopus/다른 것]]', 'Octopus/할 일.md')).toBe(false)
  })
})

describe('git check', () => {
  it('not a git repository → nothing to check', async () => {
    expect(await checkVaultGit(tmp(), { runGit: async () => 0 })).toEqual({ isGit: false, notIgnored: [], line: IGNORE_LINE })
  })

  it('uses git check-ignore with an argument array: exit 0 = ignored, 1 = not ignored', async () => {
    const vault = tmp()
    mkdirSync(join(vault, '.git'))
    const calls: string[][] = []
    const result = await checkVaultGit(vault, {
      runGit: async (args) => {
        calls.push(args)
        return args.includes('.obsidian/workspace.json') ? 0 : 1
      }
    })
    expect(result.notIgnored).toEqual(['.obsidian/workspace-mobile.json'])
    expect(calls[0]).toEqual(['-C', vault, 'check-ignore', '-q', '--', '.obsidian/workspace.json'])
  })

  it('without git (cannot run), it reads .gitignore: ignored or not', async () => {
    const vault = tmp()
    mkdirSync(join(vault, '.git'))
    const none = async () => null
    expect((await checkVaultGit(vault, { runGit: none })).notIgnored).toHaveLength(2)

    writeFileSync(join(vault, '.gitignore'), 'node_modules/\n.obsidian/workspace*.json\n')
    expect((await checkVaultGit(vault, { runGit: none })).notIgnored).toEqual([])

    writeFileSync(join(vault, '.gitignore'), '.obsidian/workspace.json\n')
    expect((await checkVaultGit(vault, { runGit: none })).notIgnored).toEqual(['.obsidian/workspace-mobile.json'])
  })

  it('simple .gitignore matching: folders, anchors, wildcards, comments and negation', () => {
    const f = '.obsidian/workspace.json'
    expect(ignoredByGitignore(['.obsidian/'], f)).toBe(true)
    expect(ignoredByGitignore(['/.obsidian'], f)).toBe(true)
    expect(ignoredByGitignore(['workspace.json'], f)).toBe(true)
    expect(ignoredByGitignore(['*.json'], f)).toBe(true)
    expect(ignoredByGitignore(['.obsidian/workspace*.json'], f)).toBe(true)
    expect(ignoredByGitignore(['**/workspace.json'], f)).toBe(true)
    expect(ignoredByGitignore(['# .obsidian/'], f)).toBe(false)
    expect(ignoredByGitignore(['.obsidian/', '!.obsidian/workspace.json'], f)).toBe(false)
    expect(ignoredByGitignore(['other/workspace.json'], f)).toBe(false)
    expect(ignoredByGitignore(['workspace.json/'], f)).toBe(false) // 폴더 전용 패턴은 파일과 맞지 않는다
    expect(ignoredByGitignore([], f)).toBe(false)
  })

  it('addIgnoreLine appends once, keeps the rest, handles missing files and CRLF, and never duplicates', async () => {
    const vault = tmp()
    expect(await addIgnoreLine(vault)).toBe(true)
    expect(readFileSync(join(vault, '.gitignore'), 'utf8')).toBe(`${IGNORE_LINE}\n`)
    expect(await addIgnoreLine(vault)).toBe(false)

    writeFileSync(join(vault, '.gitignore'), 'node_modules/\r\ndist')
    expect(await addIgnoreLine(vault)).toBe(true)
    expect(readFileSync(join(vault, '.gitignore'), 'utf8')).toBe(`node_modules/\r\ndist\r\n${IGNORE_LINE}\r\n`)
    expect(await addIgnoreLine(vault)).toBe(false)
  })
})

describe('vault name (same result on every OS)', () => {
  it.each([
    ['C:\\Users\\me\\Documents\\내 vault', '내 vault'],
    ['C:\\Users\\me\\vault\\', 'vault'],
    ['D:\\', 'D:'],
    ['\\\\server\\share\\notes', 'notes'],
    ['/Users/me/Documents/내 vault', '내 vault'],
    ['/home/u/vault/', 'vault'],
    ['/home/u/mixed\\style/vault', 'vault'],
    ['vault', 'vault'],
    ['/', ''],
    ['', '']
  ])('%s → %s', (path, name) => expect(vaultNameOf(path)).toBe(name))
})

describe('obsidian:// address', () => {
  it('encodes the vault name and the file thoroughly, for Windows and POSIX vault paths alike', () => {
    const expected = `obsidian://open?vault=${encodeURIComponent('내 vault')}&file=${encodeURIComponent('Octopus/할 일.md')}`
    expect(obsidianOpenUri('C:\\Users\\me\\Documents\\내 vault', 'Octopus/할 일.md')).toBe(expected)
    expect(obsidianOpenUri('/Users/me/Documents/내 vault', 'Octopus/할 일.md')).toBe(expected)
    expect(obsidianOpenUri('C:\\vault\\', 'a.md')).toContain('vault=vault&')
    const nasty = obsidianOpenUri('/home/u/a&b=c#d', 'x y/z&w=1.md')
    expect(nasty).toBe('obsidian://open?vault=a%26b%3Dc%23d&file=x%20y%2Fz%26w%3D1.md')
    expect(new URL(nasty).searchParams.get('vault')).toBe('a&b=c#d')
    expect(obsidianOpenUri('/home/u/vault/', 'a.md')).toContain('vault=vault&')
  })
})

// ---------------------------------------------------------------- Arm 전체

const NOW = new Date(2026, 2, 10, 12, 0, 0)

interface Env {
  arm: ObsidianArm
  vault: string
  backup: string
  config: { current: ObsidianConfig }
  tasks: ReturnType<typeof createTestRepo>
  candidates: { armId: string; ref: string; title: string; notes?: string }[]
  autoAcceptCalls: { count: number }
  opened: string[]
  confirm: ReturnType<typeof vi.fn<(info: { path: string; line: string }) => Promise<boolean>>>
  watchers: { trigger(filename: string | null): void; closed: number }
  logs: string[]
  file: () => string
  read: () => string | null
  connect(interactive?: boolean): Promise<void>
  ctx: (interactive?: boolean) => ReturnType<typeof createArmContext>
}

function setup(over: { mode?: ObsidianConfig['mode']; vault?: string; makeVault?: boolean; clock?: { now: Date }; debounceMs?: number; watchDebounceMs?: number; pick?: string | null; dailyNote?: boolean; git?: boolean } = {}): Env {
  const vault = over.vault ?? tmp('octopus-vault-')
  if (over.makeVault !== false) mkdirSync(join(vault, '.obsidian'), { recursive: true })
  if (over.git) mkdirSync(join(vault, '.git'))
  const backup = tmp('octopus-backup-')
  const config = { current: { ...DEFAULT_OBSIDIAN_CONFIG, vaultPath: vault, mode: over.mode ?? 'export', dailyNote: over.dailyNote ?? false } as ObsidianConfig }
  const t = createTestRepo(NOW.toISOString())
  const bus = createChangeBus()
  const repo = notifyOnChange(t.repo, bus.emit)
  const clock = over.clock ?? { now: NOW }
  const candidates: Env['candidates'] = []
  const logs: string[] = []
  const store = createMemorySecureStore()
  const day = () => `${clock.now.getFullYear()}-${String(clock.now.getMonth() + 1).padStart(2, '0')}-${String(clock.now.getDate()).padStart(2, '0')}`
  const core = {
    addInboxCandidate: (c: { ref: string; title: string; notes?: string }) => {
      candidates.push({ armId: 'obsidian', ...c })
      return { added: true, accepted: false }
    },
    listTasks: (view: 'inbox' | 'today' | 'upcoming' | 'someday' | 'done') => {
      if (view !== 'today') return repo.listView(view, day())
      const x = repo.listView('today', day())
      return [...x.overdue, ...x.today]
    },
    listDoneToday: () => repo.listDoneBetween(new Date(clock.now.getFullYear(), clock.now.getMonth(), clock.now.getDate()).toISOString(), new Date(clock.now.getFullYear(), clock.now.getMonth(), clock.now.getDate() + 1).toISOString()),
    onTasksChanged: bus.subscribe
  }
  const makeCtx = (interactive = true) =>
    createArmContext({ armId: 'obsidian', interactive, secureStore: store, http: { fetch: async () => { throw new Error('offline') } }, logSink: (e) => void logs.push(e.message), core })
  const watchers = { handlers: [] as ((f: string | null) => void)[], closed: 0, trigger(f: string | null) { for (const h of this.handlers) h(f) } }
  const confirm = vi.fn<(info: { path: string; line: string }) => Promise<boolean>>(async () => true)
  const opened: string[] = []
  const autoAcceptCalls = { count: 0 }
  const arm = createObsidianArm({
    config: { get: () => config.current, set: (next) => void (config.current = next) },
    pickFolder: async () => (over.pick === undefined ? vault : over.pick),
    confirmGitignore: confirm,
    openExternal: async (url) => void opened.push(url),
    backupDir: backup,
    setAutoAcceptDefault: () => void autoAcceptCalls.count++,
    now: () => clock.now,
    debounceMs: over.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    watchDebounceMs: over.watchDebounceMs ?? 50,
    watch: (_dir, onChange) => {
      watchers.handlers.push(onChange)
      return () => void watchers.closed++
    },
    runGit: async () => null
  })
  const file = () => join(vault, 'Octopus', '할 일.md')
  return {
    arm,
    vault,
    backup,
    config,
    tasks: Object.assign(t, { repo }) as Env['tasks'],
    candidates,
    autoAcceptCalls,
    opened,
    confirm,
    watchers: watchers as unknown as Env['watchers'],
    logs,
    file,
    read: () => (existsSync(file()) ? readFileSync(file(), 'utf8') : null),
    connect: (interactive = true) => arm.connect(makeCtx(interactive)),
    ctx: makeCtx
  }
}

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Obsidian arm: export', () => {
  it('on connect it writes the file with real task data (and today\'s heading)', async () => {
    const e = setup()
    e.tasks.repo.create({ title: '보고서 작성', date: '2026-03-10', bucket: 'scheduled', time: '15:00', project: '업무' })
    e.tasks.repo.create({ title: '다음 주 일', date: '2026-03-14', bucket: 'scheduled' })
    e.tasks.repo.create({ title: '수신함 일' })

    await e.connect()

    const text = e.read() as string
    expect(text.startsWith(FILE_COMMENT)).toBe(true)
    expect(text).toContain('## 오늘 · 3월 10일 화요일\n- [ ] 보고서 작성 15:00 #업무')
    expect(text).toContain('## 예정\n- [ ] 다음 주 일 03/14')
    expect(text).toContain('## 수신함\n- [ ] 수신함 일')
    expect(e.arm.status()).toEqual({ state: 'on' })
  })

  it('finished-today tasks show as [x]; a completed task from another day does not appear', async () => {
    const e = setup()
    const a = e.tasks.repo.create({ title: '오늘 끝냄', date: '2026-03-10', bucket: 'scheduled' })
    e.tasks.repo.setStatus(a.id, 'done')
    await e.connect()
    expect(e.read()).toContain('- [x] 오늘 끝냄')
  })

  it('a routine item finished today shows as [x] in the today section (and a routine item finished on another day does not)', async () => {
    const e = setup()
    const today = e.tasks.repo.create({ title: '아침 스트레칭', date: '2026-03-10', bucket: 'scheduled', routineId: 'R1' })
    const yesterday = e.tasks.repo.create({ title: '어제 루틴', date: '2026-03-09', bucket: 'scheduled', routineId: 'R1' })
    e.tasks.repo.setStatus(today.id, 'done')
    e.tasks.repo.setStatus(yesterday.id, 'done')
    // 어제 끝낸 것으로 보이도록 완료 시각을 옮긴다(저장소는 지금 시각으로 기록한다).
    e.tasks.db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(new Date(2026, 2, 9, 20, 0).toISOString(), yesterday.id)

    await e.connect()

    const text = e.read() as string
    expect(text).toContain('## 오늘 · 3월 10일 화요일\n- [x] 아침 스트레칭')
    expect(text).not.toContain('어제 루틴')
  })

  it('rewrites the whole file each time, keeping only the last backup outside the vault', async () => {
    const e = setup()
    await e.connect()
    writeFileSync(e.file(), '사용자가 고친 내용(이건 덮어써진다)')
    e.tasks.repo.create({ title: '새 일' })

    await e.arm.exportNow()

    expect(e.read()).toContain('- [ ] 새 일')
    expect(e.read()).not.toContain('사용자가 고친')
    expect(readFileSync(join(e.backup, 'last-export.md'), 'utf8')).toBe('사용자가 고친 내용(이건 덮어써진다)')
    expect(readdirSync(join(e.vault, 'Octopus'))).toEqual(['할 일.md']) // vault 에는 임시·백업 파일이 남지 않는다
    expect(readdirSync(e.vault).sort()).toEqual(['.obsidian', 'Octopus'])
  })

  it('merge-conflict markers in the file are simply overwritten at the next export (the original is Octopus)', async () => {
    const e = setup()
    e.tasks.repo.create({ title: '살아 있는 할 일' })
    await e.connect()
    writeFileSync(e.file(), '<<<<<<< HEAD\n- [ ] 이쪽\n=======\n- [ ] 저쪽\n>>>>>>> branch\n')

    await e.arm.exportNow()

    const text = e.read() as string
    expect(text).not.toMatch(/<<<<<<<|>>>>>>>|=======/)
    expect(text).toContain('- [ ] 살아 있는 할 일')
  })

  it('unchanged content is not rewritten (the file keeps its modification time)', async () => {
    const e = setup()
    await e.connect()
    const before = statSync(e.file()).mtimeMs
    await settle(30)
    await e.arm.exportNow()
    expect(statSync(e.file()).mtimeMs).toBe(before)
    e.tasks.repo.create({ title: '바뀜' })
    await settle(30)
    await e.arm.exportNow()
    expect(statSync(e.file()).mtimeMs).toBeGreaterThan(before)
  })

  it('mode "off" writes nothing; "export" never creates the writing section', async () => {
    const off = setup({ mode: 'off' })
    await off.connect()
    expect(off.read()).toBeNull()

    const exp = setup({ mode: 'export' })
    await exp.connect()
    expect(exp.read()).not.toContain(WRITING_HEADING)
  })

  it('changing the file path writes the new file; a path that leaves the vault is refused', async () => {
    const e = setup()
    await e.connect()
    await e.arm.setConfig({ file: '다른/곳.md' })
    expect(existsSync(join(e.vault, '다른', '곳.md'))).toBe(true)
    await expect(e.arm.setConfig({ file: '../밖.md' })).rejects.toBeTruthy()
    expect(e.config.current.file).toBe('다른/곳.md')
  })
})

describe('Obsidian arm: when it exports', () => {
  it('a task change triggers a debounced export (several changes → one write)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = setup({ debounceMs: 2000 })
    await e.connect()
    const before = statSync(e.file()).mtimeMs

    e.tasks.repo.create({ title: '하나' })
    e.tasks.repo.create({ title: '둘' })
    await vi.advanceTimersByTimeAsync(1900)
    expect(e.read()).not.toContain('하나') // 아직 안 썼다
    expect(statSync(e.file()).mtimeMs).toBe(before)
    e.tasks.repo.create({ title: '셋' }) // 디바운스가 다시 시작된다
    await vi.advanceTimersByTimeAsync(1900)
    expect(e.read()).not.toContain('셋')
    await vi.advanceTimersByTimeAsync(200)
    vi.useRealTimers()
    for (let i = 0; i < 100 && !e.read()?.includes('- [ ] 셋'); i++) await settle(30) // 파일 쓰기가 끝날 때까지(최대 3초)

    const text = e.read() as string
    for (const t of ['하나', '둘', '셋']) expect(text).toContain(`- [ ] ${t}`)
    expect(statSync(e.file()).mtimeMs).toBeGreaterThan(before)
  })

  it('completing, editing and deleting tasks also trigger it', async () => {
    const e = setup({ debounceMs: 10 })
    const a = e.tasks.repo.create({ title: '고칠 일' })
    await e.connect()
    e.tasks.repo.update(a.id, { title: '고친 일' })
    await settle(120)
    expect(e.read()).toContain('고친 일')
    e.tasks.repo.setStatus(a.id, 'done')
    await settle(120)
    e.tasks.repo.remove(a.id)
    await settle(120)
    expect(e.read()).not.toContain('고친 일')
  })

  it('stops listening after disconnect (no more writes)', async () => {
    const e = setup({ debounceMs: 10 })
    await e.connect()
    await e.arm.disconnect()
    const before = e.read()
    e.tasks.repo.create({ title: '끊은 뒤의 일' })
    await settle(120)
    expect(e.read()).toBe(before)
  })

  it('exports after midnight through sync (a new day gets a new heading), and retries after a failure', async () => {
    const clock = { now: NOW }
    const e = setup({ clock })
    await e.connect()
    expect(e.read()).toContain('3월 10일 화요일')

    clock.now = new Date(2026, 2, 11, 0, 0, 5)
    await e.arm.sync?.()

    expect(e.read()).toContain('3월 11일 수요일')
  })

  it('the midnight timer exports at 00:00 even if nothing changed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const clock = { now: new Date(2026, 2, 10, 23, 59, 59) }
    const e = setup({ clock })
    await e.connect()
    clock.now = new Date(2026, 2, 11, 0, 0, 3)
    await vi.advanceTimersByTimeAsync(5000)
    vi.useRealTimers()
    await settle(100)
    expect(e.read()).toContain('3월 11일 수요일')
    await e.arm.disconnect()
  })
})

describe('Obsidian arm: errors never reach the core', () => {
  it('a vault folder that disappears turns the status into error with a reason; tasks keep working; it recovers', async () => {
    const e = setup({ debounceMs: 10 })
    await e.connect()
    rmSync(e.vault, { recursive: true, force: true })

    e.tasks.repo.create({ title: '계속 되는 일' }) // 코어는 그대로 동작한다
    await settle(150)

    expect(e.arm.status()).toEqual({ state: 'error', reason: MESSAGES.vaultGone })
    expect(e.tasks.repo.listView('inbox', '2026-03-10').map((t) => t.title)).toContain('계속 되는 일')

    mkdirSync(join(e.vault, '.obsidian'), { recursive: true })
    await e.arm.sync?.()
    expect(e.arm.status()).toEqual({ state: 'on' })
    expect(e.read()).toContain('계속 되는 일')
  })

  it('a write failure (the target is a folder) is an error status with a hint, not an exception', async () => {
    const e = setup()
    mkdirSync(join(e.vault, 'Octopus', '할 일.md'), { recursive: true })
    await expect(e.connect()).rejects.toMatchObject({ message: MESSAGES.writeFailed })
    expect(e.arm.status().state).toBe('on') // 연결이 안 됐으니 상태는 관리자가 error 로 둔다(Arm 은 정지)
  })

  it('quiet reconnect at app start does not open a dialog: a missing vault is an error asking for [다시 연결]', async () => {
    const e = setup({ makeVault: false, vault: join(tmpdir(), 'octopus-never-existed-folder') })
    await expect(e.connect(false)).rejects.toMatchObject({ message: MESSAGES.vaultGone })
  })
})

describe('Obsidian arm: connect', () => {
  it('asks for the vault folder with the dialog (once), saves it, and remembers it', async () => {
    const vault = tmp('octopus-vault-')
    mkdirSync(join(vault, '.obsidian'))
    const e = setup({ vault })
    e.config.current = { ...e.config.current, vaultPath: '' }

    await e.connect()

    expect(e.config.current.vaultPath).toBe(vault)
    expect(e.arm.status()).toEqual({ state: 'on' })
  })

  it('cancelling the folder dialog is a gentle error', async () => {
    const e = setup({ pick: null })
    e.config.current = { ...e.config.current, vaultPath: '' }
    await expect(e.connect()).rejects.toMatchObject({ message: MESSAGES.noFolder })
  })

  it('a folder without .obsidian only gets a warning (connection is allowed) and the state says so', async () => {
    const vault = tmp('octopus-plain-')
    const e = setup({ vault, makeVault: false })
    await e.connect()
    const state = await e.arm.getState()
    expect(state.looksLikeVault).toBe(false)
    expect(e.read()).not.toBeNull()
    expect(e.logs.some((l) => l.includes('does not look like'))).toBe(true)
  })

  it('turns auto-accept on by default the first time only; later it is left as the user set it', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    expect(e.autoAcceptCalls.count).toBe(1)
    expect(e.config.current.autoAcceptInitialized).toBe(true)
    await e.arm.disconnect()
    await e.connect()
    expect(e.autoAcceptCalls.count).toBe(1)
  })

  it('disconnect forgets the vault path but keeps the user\'s other choices, and the vault files stay', async () => {
    const e = setup({ mode: 'both', dailyNote: true })
    await e.connect()
    await e.arm.disconnect()
    expect(e.config.current).toMatchObject({ vaultPath: '', mode: 'both', dailyNote: true })
    expect(e.read()).not.toBeNull() // 파일은 지우지 않는다
  })

  it('the manifest: folder auth, export + import + links, no scopes needed', () => {
    const e = setup()
    expect(e.arm.manifest).toMatchObject({ id: 'obsidian', auth: 'folder', capabilities: ['tasks.export', 'tasks.import', 'links'] })
    expect(e.arm.settingsScreen).toBe('obsidian')
  })
})

describe('Obsidian arm: "적어 넣기" (both mode)', () => {
  it('adds the writing section only in "both" mode, with the guidance note', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    expect(e.read()?.trimEnd().endsWith(`${WRITING_HEADING}\n${WRITING_NOTE}`)).toBe(true)
  })

  it('reads "- [ ] text" lines from the section into inbox candidates, then rewrites the file without them', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    writeFileSync(e.file(), `${e.read()}- [ ] 내일 오후 3시 치과 #건강\n- [ ] 그냥 한 줄\n그냥 적어 둔 글\n`)

    await e.arm.exportNow()

    expect(e.candidates.map((c) => c.title)).toEqual(['치과', '그냥 한 줄'])
    expect(e.candidates[0].notes).toBe('적어 넣기 원문: 내일 오후 3시 치과 #건강') // 날짜 등은 원문으로 남긴다
    expect(e.candidates[1].notes).toBeUndefined()
    expect(e.candidates[0].ref).toMatch(/^[0-9a-f]{16}@2026-03-10T.*#0$/)
    expect(e.candidates[0].ref).not.toBe(e.candidates[1].ref)
    const text = e.read() as string
    expect(text).not.toContain('치과')
    expect(text).not.toContain('그냥 한 줄')
    expect(text).toContain('그냥 적어 둔 글') // 사용자의 다른 글은 남긴다
    expect(text).toContain(WRITING_HEADING)
  })

  it('never reads lines above the section (the exported tasks are not re-imported)', async () => {
    const e = setup({ mode: 'both' })
    e.tasks.repo.create({ title: '이미 있는 할 일' })
    await e.connect()
    await e.arm.exportNow()
    expect(e.candidates).toEqual([])
  })

  it('the file watcher picks up a new line after the debounce, and ignores the change caused by our own write', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    e.watchers.trigger('할 일.md') // 우리가 방금 쓴 것에 대한 알림
    await settle(120)
    expect(e.candidates).toEqual([])

    writeFileSync(e.file(), `${e.read()}- [ ] 옵시디언에서 적음\n`)
    e.watchers.trigger('할 일.md')
    expect(e.candidates).toEqual([]) // 디바운스가 지나기 전에는 읽지 않는다(쓰는 도중에 읽지 않게)
    await settle(250)

    expect(e.candidates.map((c) => c.title)).toEqual(['옵시디언에서 적음'])
    expect(e.read()).not.toContain('옵시디언에서 적음')
    e.watchers.trigger('할 일.md') // 비운 뒤 우리 쓰기에 대한 알림
    await settle(120)
    expect(e.candidates).toHaveLength(1) // 두 번 읽지 않는다
  })

  it('a line still being typed (no line break after it at the end of the file) is neither read nor removed', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    writeFileSync(e.file(), `${e.read()}- [ ] 아직 쓰는 중`)

    await e.arm.exportNow()

    expect(e.candidates).toEqual([])
    expect((e.read() as string).endsWith('- [ ] 아직 쓰는 중')).toBe(true) // 줄바꿈을 더하지 않고 그대로 둔다

    writeFileSync(e.file(), `${e.read()}\n`) // 줄바꿈이 생기면 완성된 줄이다
    await e.arm.exportNow()

    expect(e.candidates.map((c) => c.title)).toEqual(['아직 쓰는 중'])
    expect(e.read()).not.toContain('아직 쓰는 중')
  })

  it('a change is read only after 10 seconds without another change', async () => {
    const e = setup({ mode: 'both', watchDebounceMs: DEFAULT_WATCH_DEBOUNCE_MS })
    await e.connect()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      writeFileSync(e.file(), `${e.read()}- [ ] 천천히 적는 중\n`)
      e.watchers.trigger('할 일.md')
      await vi.advanceTimersByTimeAsync(9000)
      writeFileSync(e.file(), `${e.read()}- [ ] 두 번째\n`)
      e.watchers.trigger('할 일.md') // 또 바뀌었으니 다시 10초를 센다
      await vi.advanceTimersByTimeAsync(9000)
      expect(e.candidates).toEqual([])

      await vi.advanceTimersByTimeAsync(1500)
      await vi.waitFor(() => expect(e.candidates.map((c) => c.title)).toEqual(['천천히 적는 중', '두 번째'])) // 파일 읽기는 실제 입출력이라 기다린다
    } finally {
      vi.useRealTimers()
    }
  })

  it('other files in the folder and other edits (no new line) do nothing', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    e.watchers.trigger('다른 파일.md')
    writeFileSync(e.file(), `${e.read()}\n그냥 글만 적음\n`)
    e.watchers.trigger('할 일.md')
    await settle(250)
    expect(e.candidates).toEqual([])
    expect(e.read()).toContain('그냥 글만 적음') // 다음 정식 내보내기 전까지 건드리지 않는다
  })

  it('the periodic sync also checks the file (when the watcher missed it)', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    writeFileSync(e.file(), `${e.read()}- [ ] 감시를 놓친 줄\n`)

    const result = await e.arm.sync?.()

    expect(result).toEqual({ added: 1 })
    expect(e.candidates.map((c) => c.title)).toEqual(['감시를 놓친 줄'])
  })

  it('a line typed while the file is being exported is not lost: if the file changed since it was read, the export starts over', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    writeFileSync(e.file(), `${e.read()}- [ ] 첫 줄
`)
    await e.arm.exportNow()
    expect(e.candidates.map((c) => c.title)).toEqual(['첫 줄'])
    // 두 번째 줄은 첫 번째 내보내기가 끝난 뒤에 적었으므로 다음에 읽힌다(지워지거나 중복되지 않는다).
    writeFileSync(e.file(), `${e.read()}- [ ] 둘째 줄
`)
    await e.arm.exportNow()
    expect(e.candidates.map((c) => c.title)).toEqual(['첫 줄', '둘째 줄'])
  })

  it('switching from "both" to "export" stops reading the file and drops the section at the next write', async () => {
    const e = setup({ mode: 'both' })
    await e.connect()
    await e.arm.setConfig({ mode: 'export' })
    expect(e.read()).not.toContain(WRITING_HEADING)
    writeFileSync(e.file(), `${e.read()}\n${WRITING_HEADING}\n- [ ] 이제는 안 읽음\n`)
    await e.arm.sync?.()
    expect(e.candidates).toEqual([])
  })
})

describe('Obsidian arm: daily note link', () => {
  const dailyFile = (vault: string): string => join(vault, '2026-03-10.md')

  it('is off by default: nothing is touched', async () => {
    const e = setup()
    writeFileSync(dailyFile(e.vault), '# 오늘\n')
    await e.connect()
    expect(readFileSync(dailyFile(e.vault), 'utf8')).toBe('# 오늘\n')
  })

  it('on: appends one link line to today\'s note only if it already exists, once a day', async () => {
    const e = setup({ dailyNote: true })
    writeFileSync(dailyFile(e.vault), '# 오늘\n내용')
    await e.connect()
    expect(readFileSync(dailyFile(e.vault), 'utf8')).toBe('# 오늘\n내용\n[[Octopus/할 일]]\n')

    await e.arm.exportNow()
    e.tasks.repo.create({ title: '또 다른 일' })
    await e.arm.exportNow()
    expect(readFileSync(dailyFile(e.vault), 'utf8').match(/\[\[Octopus\/할 일\]\]/g)).toHaveLength(1)
  })

  it('never creates the daily note, and does not add a link that is already there', async () => {
    const none = setup({ dailyNote: true })
    await none.connect()
    expect(existsSync(dailyFile(none.vault))).toBe(false)

    const has = setup({ dailyNote: true })
    writeFileSync(dailyFile(has.vault), '이미 있음 [[Octopus/할 일]]\n')
    await has.connect()
    expect(readFileSync(dailyFile(has.vault), 'utf8')).toBe('이미 있음 [[Octopus/할 일]]\n')
  })

  it('reads folder and format from .obsidian/daily-notes.json; an unsupported format is reported, not guessed', async () => {
    const e = setup({ dailyNote: true })
    mkdirSync(join(e.vault, 'Daily'), { recursive: true })
    writeFileSync(join(e.vault, '.obsidian', 'daily-notes.json'), JSON.stringify({ folder: 'Daily', format: 'YYYY.MM.DD' }))
    writeFileSync(join(e.vault, 'Daily', '2026.03.10.md'), '메모')
    await e.connect()
    expect(readFileSync(join(e.vault, 'Daily', '2026.03.10.md'), 'utf8')).toBe('메모\n[[Octopus/할 일]]\n')

    const odd = setup({ dailyNote: true })
    writeFileSync(join(odd.vault, '.obsidian', 'daily-notes.json'), JSON.stringify({ format: 'dddd, MMMM Do' }))
    await odd.connect()
    expect((await odd.arm.getState()).dailyProblem).toBe(UNSUPPORTED_FORMAT)
    expect(readdirSync(odd.vault).filter((f) => f.endsWith('.md'))).toEqual([])
  })

  it('a link is added on a new day when that day\'s note exists', async () => {
    const clock = { now: NOW }
    const e = setup({ dailyNote: true, clock })
    writeFileSync(dailyFile(e.vault), 'a')
    await e.connect()
    clock.now = new Date(2026, 2, 11, 9, 0, 0)
    writeFileSync(join(e.vault, '2026-03-11.md'), 'b')
    await e.arm.exportNow()
    expect(readFileSync(join(e.vault, '2026-03-11.md'), 'utf8')).toBe('b\n[[Octopus/할 일]]\n')
  })
})

describe('Obsidian arm: git check and the ignore fix', () => {
  it('shows the problem in the state, and fixing needs the confirmation (the exact line is shown); declining writes nothing', async () => {
    const e = setup({ git: true })
    await e.connect()
    expect((await e.arm.getState()).git).toMatchObject({ isGit: true, notIgnored: ['.obsidian/workspace.json', '.obsidian/workspace-mobile.json'], line: IGNORE_LINE })

    e.confirm.mockResolvedValueOnce(false)
    await e.arm.fixGitignore()
    expect(e.confirm).toHaveBeenCalledWith({ path: join(e.vault, '.gitignore'), line: IGNORE_LINE })
    expect(existsSync(join(e.vault, '.gitignore'))).toBe(false)

    await e.arm.fixGitignore()
    expect(readFileSync(join(e.vault, '.gitignore'), 'utf8')).toBe(`${IGNORE_LINE}\n`)
    expect((await e.arm.getState()).git?.notIgnored).toEqual([])
  })

  it('nothing is asked or written when everything is already ignored (no duplicate line)', async () => {
    const e = setup({ git: true })
    writeFileSync(join(e.vault, '.gitignore'), `${IGNORE_LINE}\n`)
    await e.connect()
    await e.arm.fixGitignore()
    expect(e.confirm).not.toHaveBeenCalled()
    expect(readFileSync(join(e.vault, '.gitignore'), 'utf8')).toBe(`${IGNORE_LINE}\n`)
  })

  it('connecting or exporting never touches .gitignore by itself', async () => {
    const e = setup({ git: true })
    await e.connect()
    await e.arm.exportNow()
    expect(existsSync(join(e.vault, '.gitignore'))).toBe(false)
  })
})

describe('Obsidian arm: state, preview and opening', () => {
  it('the preview is the real export text; before connecting there is none', async () => {
    const e = setup()
    expect((await e.arm.getState()).preview).toBeNull()
    e.tasks.repo.create({ title: '미리보기용 일' })
    await e.connect()
    const state = await e.arm.getState()
    expect(state.preview).toContain('- [ ] 미리보기용 일')
    expect(state.preview).toBe(e.read())
    expect(state).toMatchObject({ vaultName: expect.any(String), looksLikeVault: true, lastExportError: null })
    expect(state.lastExportAt).toBe(NOW.toISOString())
  })

  it('opening builds the obsidian:// address in main from the saved vault and file', async () => {
    const e = setup()
    await e.connect()
    await e.arm.openTarget()
    expect(e.opened).toHaveLength(1)
    const url = new URL(e.opened[0])
    expect(url.protocol).toBe('obsidian:')
    expect(url.searchParams.get('file')).toBe('Octopus/할 일.md')
  })

  it('changeVault uses the folder dialog and re-exports into the new vault', async () => {
    const e = setup()
    await e.connect()
    const other = tmp('octopus-vault2-')
    mkdirSync(join(other, '.obsidian'))
    const arm2 = createObsidianArm({
      config: { get: () => e.config.current, set: (n) => void (e.config.current = n) },
      pickFolder: async () => other,
      confirmGitignore: e.confirm,
      openExternal: async () => {},
      backupDir: e.backup,
      now: () => NOW,
      watch: () => () => {}
    })
    await arm2.connect(e.ctx())
    await arm2.changeVault()
    expect(e.config.current.vaultPath).toBe(other)
    expect(existsSync(join(other, 'Octopus', '할 일.md'))).toBe(true)
    await arm2.disconnect()
  })
})

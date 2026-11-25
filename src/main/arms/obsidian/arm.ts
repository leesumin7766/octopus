import { createHash } from 'node:crypto'
import { watch as fsWatch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ArmStatus } from '../../../shared/arms/types'
import { type ObsidianConfig, type ObsidianConfigPatch, type ObsidianState } from '../../../shared/obsidian/types'
import { localDateString } from '../../../shared/tasks/dates'
import { parseQuickInput } from '../../../shared/tasks/quickParse'
import { normalizeExportPath } from '../../../shared/validation/obsidian'
import { ArmError, type Arm, type ArmContext } from '../sdk/types'
import { dailyLinkLine, dailyNotePath, hasDailyLink } from './dailyNote'
import { addIgnoreLine, checkVaultGit, IGNORE_LINE, type RunGit } from './gitCheck'
import { renderExport, type ExportData } from './render'
import { atomicWrite, backupLast, exists, isDirectory, readIfExists, resolveInsideVault, VaultPathError } from './vault'
import { candidateRef, extractCaptured, findWritingSection, heldLastLine } from './writing'

export const OBSIDIAN_ID = 'obsidian'
export const DEFAULT_DEBOUNCE_MS = 2000
/** 파일이 바뀐 뒤 이 시간 동안 더 바뀌지 않아야 "적어 넣기"를 읽는다(옵시디언에서 적는 중에 읽지 않도록). */
export const DEFAULT_WATCH_DEBOUNCE_MS = 10_000

export const MESSAGES = {
  noFolder: '폴더를 고르지 않았어요. 다시 [연결]을 눌러 볼트 폴더를 골라 주세요.',
  vaultGone: '볼트 폴더를 찾을 수 없어요. 폴더가 있는지 확인하고 [다시 연결]을 눌러 주세요.',
  needFolder: '볼트 폴더를 다시 골라야 해요. [다시 연결]을 눌러 주세요.',
  badPath: '내보낼 파일 경로가 볼트 밖이거나 올바르지 않아요. 설정에서 고쳐 주세요.',
  writeFailed: '파일을 쓰지 못했어요. 볼트 폴더에 쓸 권한이 있는지, 파일이 다른 프로그램에서 열려 잠겨 있지 않은지 확인해 주세요.',
  notVault: '옵시디언 볼트가 아닌 것 같아요(.obsidian 폴더가 없어요).'
} as const

/** 설정 저장소 중 Arm 이 쓰는 부분 */
export interface ConfigStore {
  get(): ObsidianConfig
  set(next: ObsidianConfig): void
}

export interface ObsidianArmDeps {
  config: ConfigStore
  /** main 의 폴더 선택 대화상자. 고른 경로, 취소하면 null. (렌더러가 경로를 보내는 길은 없다.) */
  pickFolder: () => Promise<string | null>
  /** .gitignore 에 줄을 더하기 전 확인 창. 사용자가 허용했을 때만 true. */
  confirmGitignore: (info: { path: string; line: string }) => Promise<boolean>
  /** 시스템 앱으로 주소 열기(obsidian://…) */
  openExternal: (url: string) => Promise<void>
  /** 덮어쓰기 전 기존 파일을 마지막 1개 보관하는 폴더(userData 쪽) */
  backupDir: string
  /** 처음 연결할 때 "적어 넣기" 후보 자동 수락을 켜 둔다 */
  setAutoAcceptDefault?: () => void
  now?: () => Date
  /** 파일 변경 감시(시험에서는 가짜를 넣는다). 돌려주는 함수로 감시를 끝낸다. */
  watch?: (dir: string, onChange: (filename: string | null) => void) => () => void
  runGit?: RunGit
  /** 할 일이 바뀐 뒤 내보내기까지의 대기(ms) */
  debounceMs?: number
  /** 파일이 바뀐 뒤 "적어 넣기"를 읽기까지의 대기(ms). 쓰는 도중에 읽지 않도록 길게 둔다. */
  watchDebounceMs?: number
  /**
   * 시간 뒤에 저절로 하는 일(디바운스 내보내기·자정 내보내기·파일 감시 확인)이 하나 끝날 때마다 부른다.
   * 시험이 실제 시간을 재지 않고 그 일이 끝나기를 직접 기다리게 하려는 알림이다(앱에서는 쓰지 않는다).
   */
   onSettled?: (kind: 'export' | 'watch') => void
}

export interface ObsidianArm extends Arm {
  getState(): Promise<ObsidianState>
  setConfig(patch: ObsidianConfigPatch): Promise<ObsidianState>
  changeVault(): Promise<ObsidianState>
  exportNow(): Promise<ObsidianState>
  fixGitignore(): Promise<ObsidianState>
  /** 원형 메뉴 칸이 여는 주소(main 이 만든다) */
  openTarget(): Promise<void>
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * vault 폴더 이름(마지막 조각). 실행 중인 OS 와 상관없이 \ 와 / 를 모두 구분자로 본다
 * (macOS 에서 Windows 형식 경로를 받아도, 그 반대여도 같은 결과).
 */
export function vaultNameOf(vaultPath: string): string {
  const parts = vaultPath.split(/[\\/]+/).filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** obsidian://open 주소: 값은 모두 인코딩한다. */
export function obsidianOpenUri(vaultPath: string, file: string): string {
  const name = vaultNameOf(vaultPath)
  return `obsidian://open?vault=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`
}

const realWatch = (dir: string, onChange: (filename: string | null) => void): (() => void) => {
  const watcher = fsWatch(dir, { persistent: false }, (_event, filename) => onChange(filename ? String(filename) : null))
  watcher.on('error', () => undefined)
  return () => watcher.close()
}

export function createObsidianArm(deps: ObsidianArmDeps): ObsidianArm {
  const now = deps.now ?? (() => new Date())
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const watchDebounceMs = deps.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS
  const watch = deps.watch ?? realWatch

  let ctx: ArmContext | null = null
  let connected = false
  let lastWriteHash: string | null = null
  let lastExportAt: string | null = null
  let lastError: string | null = null
  let lastExportDate = ''
  let dailyDoneDate = ''
  let dailyProblem: string | null = null
  let unsubscribe: (() => void) | null = null
  let closeWatcher: (() => void) | null = null
  let exportTimer: ReturnType<typeof setTimeout> | null = null
  let watchTimer: ReturnType<typeof setTimeout> | null = null
  let midnightTimer: ReturnType<typeof setTimeout> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const cfg = (): ObsidianConfig => deps.config.get()
  const patchConfig = (patch: Partial<ObsidianConfig>): void => deps.config.set({ ...cfg(), ...patch })
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  // ---- 데이터 모으기·그리기 ----

  function gather(core: ArmContext['core']): ExportData {
    const today = localDateString(now())
    const open = core.listTasks('today')
    const done = core.listDoneToday() // 루틴 항목도 들어 있다
    return {
      today,
      overdue: open.filter((t) => t.date !== null && t.date < today),
      dueToday: open.filter((t) => t.date === null || t.date >= today),
      upcoming: core.listTasks('upcoming'),
      someday: core.listTasks('someday'),
      inbox: core.listTasks('inbox'),
      doneToday: done
    }
  }

  // ---- 내보내기 ----

  /** 일일노트 링크: 오늘 노트가 이미 있을 때만, 하루에 한 번, 맨 끝에 한 줄. 새 노트는 만들지 않는다. */
  async function ensureDailyLink(vault: string, file: string): Promise<void> {
    dailyProblem = null
    if (!cfg().dailyNote) return
    const date = now()
    const today = localDateString(date)
    if (dailyDoneDate === today) return

    const settingsPath = join(vault, '.obsidian', 'daily-notes.json')
    let settings: unknown
    try {
      const raw = await readIfExists(settingsPath)
      settings = raw === null ? undefined : (JSON.parse(raw) as unknown)
    } catch {
      settings = undefined
    }
    const note = dailyNotePath(settings, date)
    if (!note.ok) {
      dailyProblem = note.problem
      return
    }
    let target: string
    try {
      target = await resolveInsideVault(vault, note.path)
    } catch {
      dailyProblem = '일일노트 폴더가 볼트 밖에 있어요.'
      return
    }
    const content = await readIfExists(target)
    if (content === null) return // 오늘 노트가 아직 없다: 만들지 않는다(내일 다시 확인하지 않고 오늘 안에 생기면 다음 내보내기에서 붙인다).
    dailyDoneDate = today
    if (hasDailyLink(content, file)) return
    await atomicWrite(target, `${content}${content === '' || content.endsWith('\n') ? '' : '\n'}${dailyLinkLine(file)}\n`)
  }

  /** "적어 넣기" 에서 읽어 간 줄을 수신함 후보로 보낸다. */
  function importCaptured(core: ArmContext['core'], items: string[], readAt: Date): number {
    const today = localDateString(readAt)
    let added = 0
    items.forEach((text, index) => {
      try {
        const parsed = parseQuickInput(text, today)
        const title = parsed.title.trim() || text
        const result = core.addInboxCandidate({
          ref: candidateRef(text, readAt, index),
          title,
          // 날짜·프로젝트 같은 해석 결과는 쓰지 않고 원문을 남긴다(사용자가 수신함에서 보고 고른다).
          ...(title !== text ? { notes: `적어 넣기 원문: ${text}` } : {})
        })
        if (result.added) added++
      } catch {
        ctx?.log.warn('could not import a written line')
      }
    })
    return added
  }

  type ExportResult = { ok: true; wrote: boolean; imported: number } | { ok: false; reason: string }

  async function runExport(): Promise<ExportResult> {
    const context = ctx
    const config = cfg()
    if (!context || config.mode === 'off') return { ok: true, wrote: false, imported: 0 }
    const fail = (reason: string): ExportResult => {
      lastError = reason
      context.log.warn(`export failed: ${reason}`)
      return { ok: false, reason }
    }

    const vault = config.vaultPath
    if (!vault || !(await isDirectory(vault))) return fail(MESSAGES.vaultGone)
    let target: string
    try {
      target = await resolveInsideVault(vault, config.file)
    } catch (error) {
      return fail(error instanceof VaultPathError ? MESSAGES.badPath : MESSAGES.writeFailed)
    }

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await readIfExists(target)
        const readAt = now()
        let captured: string[] = []
        let writingLines: string[] | null = null
        let holding = false
        if (config.mode === 'both') {
          const section = existing === null ? null : findWritingSection(existing)
          const held = section === null || existing === null ? null : heldLastLine(existing, section)
          const split = extractCaptured(held ? held.complete : (section?.lines ?? []))
          captured = split.items
          // 아직 쓰는 중인 마지막 줄은 가져가지도 지우지도 않고 구역 맨 아래에 그대로 둔다.
          writingLines = held && held.last !== null ? [...split.rest, held.last] : split.rest
          holding = held !== null && held.last !== null
        }
        const rendered = renderExport(gather(context.core), { writingLines })
        // 쓰는 중인 줄이 파일 끝에 있으면 줄바꿈을 더하지 않고 그 줄로 끝낸다(사용자가 이어서 적을 수 있게).
        const content = holding ? rendered.replace(/\r?\n$/, '') : rendered

        if (existing === content) {
          lastWriteHash = sha256(content)
          markDone()
          await ensureDailyLink(vault, config.file)
          return { ok: true, wrote: false, imported: 0 }
        }
        if (existing !== null) await backupLast(target, deps.backupDir)
        // 읽은 뒤 사용자가 파일을 고쳤으면(옵시디언에서 적는 중) 다시 읽어 처음부터 한다 — 적은 줄을 덮어써서 잃지 않게.
        if ((await readIfExists(target)) !== existing) continue

        await atomicWrite(target, content)
        lastWriteHash = sha256(content)
        const imported = importCaptured(context.core, captured, readAt) // 쓰기가 끝난 뒤에 넘긴다(쓰기가 실패하면 줄이 파일에 그대로 남는다).
        markDone()
        await ensureDailyLink(vault, config.file)
        return { ok: true, wrote: true, imported }
      }
      return fail(MESSAGES.writeFailed)
    } catch {
      return fail(MESSAGES.writeFailed)
    }
  }

  function markDone(): void {
    lastError = null
    lastExportAt = now().toISOString()
    lastExportDate = localDateString(now())
  }

  const exportQueued = (): Promise<ExportResult> => enqueue(runExport)

  /** 알림은 표시용이라 받는 쪽이 실패해도 일에는 영향이 없다. */
  function settled(kind: 'export' | 'watch'): void {
    try {
      deps.onSettled?.(kind)
    } catch {
      // 무시
    }
  }

  // ---- 일정·감시 ----

  function scheduleExport(): void {
    if (exportTimer) clearTimeout(exportTimer)
    exportTimer = setTimeout(() => {
      exportTimer = null
      void exportQueued().finally(() => settled('export'))
    }, debounceMs)
  }

  function scheduleMidnight(): void {
    if (midnightTimer) clearTimeout(midnightTimer)
    const n = now()
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 2, 0)
    midnightTimer = setTimeout(() => {
      midnightTimer = null
      void exportQueued().then(() => scheduleMidnight()).finally(() => settled('export'))
    }, Math.max(1000, next.getTime() - n.getTime()))
  }

  /** 파일이 우리가 쓴 것과 다르고 "적어 넣기" 에 새 줄이 있으면 읽어 가고 다시 쓴다. 그 밖의 고침에는 아무것도 하지 않는다. */
  async function checkWriting(): Promise<boolean> {
    if (!connected || cfg().mode !== 'both') return false
    const vault = cfg().vaultPath
    let target: string
    try {
      target = await resolveInsideVault(vault, cfg().file)
    } catch {
      return false
    }
    const content = await readIfExists(target).catch(() => null)
    if (content === null || sha256(content) === lastWriteHash) return false // 우리가 쓴 직후의 변경은 무시
    const section = findWritingSection(content)
    if (!section || extractCaptured(section.lines).items.length === 0) return false
    const result = await exportQueued()
    return result.ok && result.imported > 0
  }

  function startWatcher(): void {
    closeWatcher?.()
    closeWatcher = null
    if (!connected || cfg().mode !== 'both' || !cfg().vaultPath) return
    const target = join(cfg().vaultPath, ...cfg().file.split('/'))
    try {
      closeWatcher = watch(dirname(target), (filename) => {
        if (filename !== null && filename !== basename(target)) return
        if (watchTimer) clearTimeout(watchTimer)
        watchTimer = setTimeout(() => {
          watchTimer = null
          void checkWriting().finally(() => settled('watch'))
        }, watchDebounceMs)
      })
    } catch {
      closeWatcher = null // 폴더가 아직 없으면(첫 내보내기 전) 감시하지 않는다. 주기 sync 가 대신 확인한다.
    }
  }

  function stopAll(): void {
    for (const timer of [exportTimer, watchTimer, midnightTimer]) if (timer) clearTimeout(timer)
    exportTimer = watchTimer = midnightTimer = null
    closeWatcher?.()
    closeWatcher = null
    unsubscribe?.()
    unsubscribe = null
    connected = false
  }

  async function applyConfigChange(): Promise<void> {
    startWatcher()
    if (connected) await exportQueued()
  }

  // ---- 상태 ----

  async function getState(): Promise<ObsidianState> {
    const config = cfg()
    const vault = config.vaultPath
    const vaultOk = vault !== '' && (await isDirectory(vault))
    let preview: string | null = null
    if (ctx) {
      let writingLines: string[] | null = null
      if (config.mode === 'both') {
        writingLines = []
        try {
          const existing = vaultOk ? await readIfExists(await resolveInsideVault(vault, config.file)) : null
          const section = existing === null ? null : findWritingSection(existing)
          if (section) writingLines = extractCaptured(section.lines).rest
        } catch {
          writingLines = []
        }
      }
      try {
        preview = renderExport(gather(ctx.core), { writingLines })
      } catch {
        preview = null
      }
    }
    return {
      status: arm.status(),
      available: true,
      config,
      vaultName: vaultNameOf(vault),
      looksLikeVault: vaultOk && (await exists(join(vault, '.obsidian'))),
      lastExportAt,
      lastExportError: lastError,
      dailyProblem,
      git: vaultOk ? await checkVaultGit(vault, { runGit: deps.runGit }).catch(() => null) : null,
      preview
    }
  }

  const arm: ObsidianArm = {
    manifest: {
      id: OBSIDIAN_ID,
      name: '옵시디언',
      version: '0.1.0',
      auth: 'folder',
      capabilities: ['tasks.export', 'tasks.import', 'links'],
      description: '할 일을 볼트 안의 파일 하나로 내보내요. 그 파일은 Octopus 가 통째로 덮어써요. 옵시디언의 다른 노트는 건드리지 않아요.',
      syncIntervalMinutes: 5
    },
    settingsScreen: 'obsidian',

    async connect(context) {
      ctx = context
      stopAll()
      const config = cfg()
      let vault = config.vaultPath
      if (!vault || !(await isDirectory(vault))) {
        // 자동 재연결(앱을 켤 때)에서는 대화상자를 띄우지 않는다.
        if (!context.interactive) throw new ArmError(vault ? MESSAGES.vaultGone : MESSAGES.needFolder)
        const picked = await deps.pickFolder()
        if (!picked) throw new ArmError(MESSAGES.noFolder)
        vault = picked
        patchConfig({ vaultPath: vault })
      }
      if (!(await exists(join(vault, '.obsidian')))) context.log.warn('the folder does not look like an Obsidian vault')

      if (!cfg().autoAcceptInitialized) {
        patchConfig({ autoAcceptInitialized: true })
        deps.setAutoAcceptDefault?.() // 사용자가 직접 적은 줄이라 기본은 확인 없이 수신함으로(카드의 체크박스로 끌 수 있다)
      }

      connected = true
      unsubscribe = context.core.onTasksChanged(scheduleExport)
      scheduleMidnight()
      startWatcher()
      const first = await exportQueued()
      if (!first.ok) {
        stopAll()
        throw new ArmError(first.reason)
      }
      startWatcher() // 첫 내보내기로 폴더가 생겼을 수 있다.
    },

    async disconnect() {
      stopAll()
      patchConfig({ vaultPath: '' }) // vault 를 잊는다(다음 연결에서 다시 고른다). 모드·파일 이름 같은 선택은 남긴다.
      lastExportAt = null
      lastError = null
      lastWriteHash = null
      dailyDoneDate = ''
    },

    dispose() {
      stopAll()
    },

    status: (): ArmStatus => (connected && lastError ? { state: 'error', reason: lastError } : { state: 'on' }),

    async sync() {
      if (!connected) return {}
      let added = 0
      const today = localDateString(now())
      if (lastError || lastExportDate !== today) {
        const r = await exportQueued() // 날짜가 바뀌었거나 이전 내보내기가 실패했으면 다시
        if (r.ok) added += r.imported
        return { added }
      }
      if (await checkWriting()) added = 1
      return { added }
    },

    getState,

    async setConfig(patch) {
      const next: ObsidianConfig = { ...cfg() }
      if (patch.mode !== undefined) next.mode = patch.mode
      if (patch.file !== undefined) {
        const file = normalizeExportPath(patch.file)
        if (!file) throw new ArmError(MESSAGES.badPath)
        next.file = file
      }
      if (patch.dailyNote !== undefined) {
        next.dailyNote = patch.dailyNote
        dailyDoneDate = '' // 켜면 오늘 다시 확인한다
      }
      deps.config.set(next)
      await applyConfigChange()
      return getState()
    },

    async changeVault() {
      const picked = await deps.pickFolder()
      if (picked) {
        patchConfig({ vaultPath: picked })
        dailyDoneDate = ''
        await applyConfigChange()
      }
      return getState()
    },

    async exportNow() {
      if (connected) await exportQueued()
      return getState()
    },

    async fixGitignore() {
      const vault = cfg().vaultPath
      if (vault && (await isDirectory(vault))) {
        const git = await checkVaultGit(vault, { runGit: deps.runGit })
        // 자동으로 고치지 않는다: 점검에서 빠진 것이 있을 때만, 추가할 줄을 그대로 보여 주고 허용했을 때만 쓴다.
        if (git.isGit && git.notIgnored.length > 0 && (await deps.confirmGitignore({ path: join(vault, '.gitignore'), line: IGNORE_LINE }))) {
          await addIgnoreLine(vault, IGNORE_LINE)
        }
      }
      return getState()
    },

    async openTarget() {
      const config = cfg()
      if (!config.vaultPath) throw new ArmError(MESSAGES.needFolder)
      await deps.openExternal(obsidianOpenUri(config.vaultPath, config.file))
    }
  }
  return arm
}

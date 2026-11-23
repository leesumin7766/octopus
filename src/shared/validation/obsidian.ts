import { DEFAULT_OBSIDIAN_CONFIG, type ObsidianConfig, type ObsidianConfigPatch, type ObsidianMode } from '../obsidian/types'
import { bad, good, isPlainObject, type Parsed } from './taskIpc'

const MAX_PATH = 200
// Windows 에서 파일 이름에 쓸 수 없는 글자
const BAD_SEGMENT_CHARS = /[<>:"|?*\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * 내보낼 파일 경로(vault 기준 상대): 정규화한 경로(슬래시 구분)를 돌려주고, 안 되면 null.
 * 거부: 빈 값, 절대 경로(/ \ 로 시작·드라이브 문자·UNC), '..' 조각, .md 가 아닌 것, Windows 에서 못 쓰는 글자·예약 이름, 너무 긴 것.
 * (정규화 뒤에 vault 밖으로 나가는지는 main 이 실제 경로로 한 번 더 확인한다.)
 */
export function normalizeExportPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > MAX_PATH) return null
  if (/^[\\/]/.test(text) || /^[a-zA-Z]:/.test(text)) return null // 절대 경로·드라이브 문자·UNC
  const segments = text.split(/[\\/]+/)
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  if (segments.some((s) => BAD_SEGMENT_CHARS.test(s) || /[. ]$/.test(s) || RESERVED.test(s))) return null
  const file = segments[segments.length - 1]
  if (!/\.md$/i.test(file) || file.length <= 3) return null
  return segments.join('/')
}

const MODES: readonly unknown[] = ['off', 'export', 'both']
const isMode = (v: unknown): v is ObsidianMode => MODES.includes(v)

/** 새로 저장하는 설정 검사(vault 경로는 문자열이면 받되, 화면에서 보내는 값이 아니라 main 이 정한 값이다). */
export function parseObsidianConfig(raw: unknown): ObsidianConfig | null {
  if (!isPlainObject(raw)) return null
  const file = normalizeExportPath(raw.file)
  if (!file || !isMode(raw.mode) || typeof raw.dailyNote !== 'boolean' || typeof raw.autoAcceptInitialized !== 'boolean') return null
  if (typeof raw.vaultPath !== 'string' || raw.vaultPath.length > 1000 || raw.vaultPath.includes('\0')) return null
  return { vaultPath: raw.vaultPath, mode: raw.mode, file, dailyNote: raw.dailyNote, autoAcceptInitialized: raw.autoAcceptInitialized }
}

/** 저장되어 있던 값을 읽는다. 깨진 곳은 기본값으로 대신한다. */
export function normalizeObsidianConfig(raw: unknown): ObsidianConfig {
  const d = DEFAULT_OBSIDIAN_CONFIG
  if (!isPlainObject(raw)) return { ...d }
  return {
    vaultPath: typeof raw.vaultPath === 'string' && raw.vaultPath.length <= 1000 && !raw.vaultPath.includes('\0') ? raw.vaultPath : d.vaultPath,
    mode: isMode(raw.mode) ? raw.mode : d.mode,
    file: normalizeExportPath(raw.file) ?? d.file,
    dailyNote: raw.dailyNote === true,
    autoAcceptInitialized: raw.autoAcceptInitialized === true
  }
}

/** 화면에서 보내는 설정 변경: mode / file / dailyNote 만. vault 경로는 받지 않는다. */
export function parseObsidianPatch(value: unknown): Parsed<ObsidianConfigPatch> {
  if (!isPlainObject(value)) return bad('input')
  if (!Object.keys(value).every((k) => k === 'mode' || k === 'file' || k === 'dailyNote')) return bad('input')
  const patch: ObsidianConfigPatch = {}
  if (value.mode !== undefined) {
    if (!isMode(value.mode)) return bad('mode')
    patch.mode = value.mode
  }
  if (value.file !== undefined) {
    const file = normalizeExportPath(value.file)
    if (!file) return bad('file')
    patch.file = file
  }
  if (value.dailyNote !== undefined) {
    if (typeof value.dailyNote !== 'boolean') return bad('dailyNote')
    patch.dailyNote = value.dailyNote
  }
  return Object.keys(patch).length === 0 ? bad('input') : good(patch)
}

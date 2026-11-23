import { normalizeExportPath } from '../../../shared/validation/obsidian'

// 일일노트 링크: vault 의 .obsidian/daily-notes.json 으로 "오늘 노트" 경로를 계산한다. YYYY·MM·DD 토큰만 지원한다. 순수 함수.

export const UNSUPPORTED_FORMAT = '이 일일노트 형식은 아직 지원하지 않아요.'

export type DailyPath = { ok: true; path: string } | { ok: false; problem: string }

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/**
 * daily-notes.json 의 내용(이미 JSON 으로 읽은 값, 없으면 undefined)과 날짜로 오늘 노트의 vault 기준 경로를 돌려준다.
 * format 에 YYYY·MM·DD 가 아닌 토큰(영문 글자·대괄호)이 있으면 지원하지 않는다. folder 는 vault 밖으로 나갈 수 없다.
 */
export function dailyNotePath(settings: unknown, date: Date): DailyPath {
  const s = (typeof settings === 'object' && settings !== null ? settings : {}) as { folder?: unknown; format?: unknown }
  const format = typeof s.format === 'string' && s.format.trim() !== '' ? s.format.trim() : 'YYYY-MM-DD'
  const folder = typeof s.folder === 'string' ? s.folder.trim().replace(/^[\\/]+|[\\/]+$/g, '') : ''

  const leftover = format.replace(/YYYY|MM|DD/g, '')
  if (/[A-Za-z[\]\\]/.test(leftover)) return { ok: false, problem: UNSUPPORTED_FORMAT }

  const name = format.replace(/YYYY|MM|DD/g, (token) => (token === 'YYYY' ? pad(date.getFullYear(), 4) : token === 'MM' ? pad(date.getMonth() + 1) : pad(date.getDate())))
  const path = normalizeExportPath(`${folder ? `${folder}/` : ''}${name}.md`)
  return path ? { ok: true, path } : { ok: false, problem: UNSUPPORTED_FORMAT }
}

/** 일일노트 끝에 붙일 링크 한 줄(내보낸 파일 경로에서 .md 를 뺀 것) */
export const dailyLinkLine = (exportFile: string): string => `[[${exportFile.replace(/\.md$/i, '')}]]`

/** 이미 같은 링크가 들어 있는지(별칭 [[…|이름]] 도 같은 것으로 본다) */
export function hasDailyLink(content: string, exportFile: string): boolean {
  const target = exportFile.replace(/\.md$/i, '')
  return content.includes(`[[${target}]]`) || content.includes(`[[${target}|`) || content.includes(`[[${target}#`)
}

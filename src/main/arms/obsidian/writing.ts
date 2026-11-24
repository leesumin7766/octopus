import { createHash } from 'node:crypto'
import { WRITING_HEADING, WRITING_NOTE } from './render'

// "적어 넣기" 구역: 파일 맨 아래에서 사용자가 "- [ ] 텍스트" 로 적은 줄만 읽어 간다. 순수 함수.

export interface WritingSection {
  /** 구역 제목 줄 번호(0 부터) */
  headingIndex: number
  /** 제목 아래부터 파일 끝(또는 다음 ## 제목 앞)까지의 줄 */
  lines: string[]
}

/** 파일 내용에서 "## 적어 넣기" 구역을 찾는다. 없으면 null. */
export function findWritingSection(content: string): WritingSection | null {
  const lines = content.split(/\r?\n/)
  const headingIndex = lines.findIndex((l) => l.trim() === WRITING_HEADING)
  if (headingIndex < 0) return null
  const rest = lines.slice(headingIndex + 1)
  const next = rest.findIndex((l) => /^##\s/.test(l))
  return { headingIndex, lines: next < 0 ? rest : rest.slice(0, next) }
}

/**
 * 구역의 마지막 줄이 파일 끝에 줄바꿈 없이 적혀 있으면(옵시디언에서 아직 적는 중일 수 있다) 그 줄을 따로 뗀다.
 * 구역이 파일 끝까지 이어질 때만 해당한다(뒤에 ## 제목이 있으면 그 줄은 이미 끝난 줄이다).
 */
export function heldLastLine(content: string, section: WritingSection): { complete: string[]; last: string | null } {
  const fileLines = content.split(/\r?\n/)
  const endsAtFileEnd = section.headingIndex + section.lines.length === fileLines.length - 1
  if (content.endsWith('\n') || !endsAtFileEnd || section.lines.length === 0) return { complete: section.lines, last: null }
  return { complete: section.lines.slice(0, -1), last: section.lines[section.lines.length - 1] }
}

const ITEM = /^\s*[-*+]\s+\[ \]\s*(.*)$/

export interface Captured {
  /** 읽어 갈 줄들의 글자(체크박스 뒤) */
  items: string[]
  /** 구역에 남길 줄들: 안내 주석과 읽어 간 줄을 뺀 나머지(사용자의 다른 글). 앞뒤 빈 줄은 정리한다. */
  rest: string[]
}

/** 구역의 줄에서 "- [ ] 텍스트" 줄을 골라낸다. 글자가 없는 빈 체크박스는 버린다. 끝낸 "- [x]" 줄이나 다른 글은 그대로 둔다. */
export function extractCaptured(lines: readonly string[]): Captured {
  const items: string[] = []
  const rest: string[] = []
  for (const line of lines) {
    if (line.trim() === WRITING_NOTE) continue
    const match = ITEM.exec(line)
    if (match) {
      const text = match[1].trim()
      if (text !== '') items.push(text)
      continue
    }
    rest.push(line)
  }
  while (rest.length > 0 && rest[0].trim() === '') rest.shift()
  while (rest.length > 0 && rest[rest.length - 1].trim() === '') rest.pop()
  return { items, rest }
}

/** 줄 내용의 짧은 지문 */
export const lineHash = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)

/** 후보 ref: 줄 내용 지문 + 읽은 시각(+같은 읽기 안의 순번) */
export const candidateRef = (text: string, readAt: Date, index: number): string => `${lineHash(text)}@${readAt.toISOString()}#${index}`

// N5 독립 검증(Opus): 화면이 쓰는 색 토큰은 모두 index.css 에 정의돼 있고, Tailwind 기본 회색·파랑 계열을 새로 쓰지 않는다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../src/renderer')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(tsx|ts)$/.test(name) ? [path] : []
  })
}

const sources = files(ROOT).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const css = readFileSync(join(ROOT, 'index.css'), 'utf8')
const defined = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]))

describe('N5 (Opus)', () => {
  it('index.css defines the base tokens the standard names', () => {
    for (const name of ['page', 'ink', 'line', 'accent', 'accent-strong']) expect(defined.has(name), name).toBe(true)
  })

  it('every custom color token used in a class exists in index.css', () => {
    const custom = /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|decoration)-((?:page|ink|line|nav|accent)(?:-[a-z]+)?)\b/g
    const missing: string[] = []
    for (const { path, text } of sources) {
      for (const m of text.matchAll(custom)) if (!defined.has(m[1])) missing.push(`${path.slice(ROOT.length)}: ${m[0]}`)
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('no Tailwind default gray/blue families (slate, gray, zinc, neutral, stone, indigo, blue) in screens', () => {
    const banned = /\b(?:bg|text|border|ring|divide|placeholder|from|to|outline)-(?:slate|gray|zinc|neutral|stone|indigo|blue)-\d{2,3}\b/g
    const hits: string[] = []
    for (const { path, text } of sources) for (const m of text.matchAll(banned)) hits.push(`${path.slice(ROOT.length)}: ${m[0]}`)
    expect(hits).toEqual([])
  })
})

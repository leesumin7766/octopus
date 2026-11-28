import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 화면 기준(UI_STANDARD) 4장: 색은 index.css 토큰(또는 주변 화면과 같은 값)만 쓴다. Tailwind 기본 slate·indigo 직접 사용을 막는다.
const ROOT = join(__dirname, '..', '..', 'src', 'renderer')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(tsx|css)$/.test(name) ? [path] : []
  })
}

// 'translate-x-1/2' 같은 이름 안의 'slate-' 는 제외한다.
const OLD_COLOR = /(?<![\w-])(slate|indigo)-\d/

describe('color tokens', () => {
  const all = files(ROOT)

  it('finds the renderer files', () => {
    expect(all.length).toBeGreaterThan(40)
  })

  it('no renderer .tsx/.css uses Tailwind slate-* or indigo-*', () => {
    const found = all
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line }))
      )
      .filter((entry) => OLD_COLOR.test(entry.text))
      .map((entry) => `${entry.file.slice(ROOT.length + 1)}:${entry.line}: ${entry.text.trim().slice(0, 100)}`)
    expect(found).toEqual([])
  })
})

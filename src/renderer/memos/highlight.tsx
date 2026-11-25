import type { ReactNode } from 'react'

// 검색어와 일치하는 부분을 <mark> 로 감싼 React 요소 목록을 돌려준다.
// innerHTML 을 쓰지 않는다: 본문은 항상 글자(텍스트 노드)로만 들어가므로 본문 안의 HTML 모양 글자도 그대로 보인다.

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 대소문자를 무시하고 검색어가 나오는 곳을 <mark> 로. 검색어가 비면 본문 그대로. */
export function highlightMatches(text: string, query: string): ReactNode[] {
  const needle = query.trim()
  if (needle === '') return [text]

  const pattern = new RegExp(escapeRegExp(needle), 'gi')
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-200 px-0.5 text-inherit">
        {match[0]}
      </mark>
    )
    last = start + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 0 ? [text] : parts
}

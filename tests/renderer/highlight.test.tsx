// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { highlightMatches } from '../../src/renderer/memos/highlight'

function marks(text: string, query: string): string[] {
  const { container } = render(<p>{highlightMatches(text, query)}</p>)
  return Array.from(container.querySelectorAll('mark')).map((mark) => mark.textContent ?? '')
}

describe('highlightMatches', () => {
  it('wraps each match in a mark and keeps the rest as plain text', () => {
    const { container } = render(<p>{highlightMatches('회의 메모 회의 정리', '회의')}</p>)
    expect(container.querySelectorAll('mark')).toHaveLength(2)
    expect(container.textContent).toBe('회의 메모 회의 정리')
  })

  it('ignores case', () => {
    expect(marks('Hello hello HELLO', 'hello')).toEqual(['Hello', 'hello', 'HELLO'])
  })

  it('a query with regular-expression characters is taken literally', () => {
    expect(marks('a.b axb (x)* [y] \\ z', 'a.b')).toEqual(['a.b'])
    expect(marks('a.b axb (x)* [y] \\ z', '(x)*')).toEqual(['(x)*'])
    expect(marks('a.b axb (x)* [y] \\ z', '[y]')).toEqual(['[y]'])
    expect(marks('a.b axb (x)* [y] \\ z', '\\')).toEqual(['\\'])
    expect(marks('a+b a+b', 'a+')).toEqual(['a+', 'a+'])
    expect(marks('x.* y', '.*')).toEqual(['.*'])
  })

  it('HTML-looking body text stays as letters, not as elements', () => {
    const body = '<img src=x onerror="alert(1)"> <b>굵게</b> & <script>x</script>'
    const { container } = render(<p>{highlightMatches(body, '굵게')}</p>)

    expect(container.textContent).toBe(body)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull() // <b> 는 글자로 남는다
    expect(container.querySelectorAll('mark')).toHaveLength(1)
  })

  it('a query that looks like a tag does not create elements', () => {
    const { container } = render(<p>{highlightMatches('<b>x</b>', '<b>')}</p>)
    expect(container.textContent).toBe('<b>x</b>')
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelectorAll('mark')).toHaveLength(1)
  })

  it('an empty or blank query returns the text unchanged', () => {
    expect(marks('본문', '')).toEqual([])
    expect(marks('본문', '   ')).toEqual([])
  })

  it('no match returns the text unchanged', () => {
    const { container } = render(<p>{highlightMatches('본문', '없음')}</p>)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toBe('본문')
  })
})

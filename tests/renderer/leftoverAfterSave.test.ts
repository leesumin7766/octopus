import { describe, expect, it } from 'vitest'
import { leftoverAfterSave } from '../../src/renderer/memos/leftoverAfterSave'

describe('leftoverAfterSave', () => {
  it('clears the box when it still shows exactly what was sent', () => {
    expect(leftoverAfterSave('빵 사 오기', '빵 사 오기')).toBe('')
  })

  it('keeps the full current text when more was typed, without stripping the sent part', () => {
    expect(leftoverAfterSave('첫 글 더 쓴 내용', '첫 글')).toBe('첫 글 더 쓴 내용')
    expect(leftoverAfterSave('첫 글\n\n다음 줄', '첫 글')).toBe('첫 글\n\n다음 줄')
  })

  it('keeps the box as is when the sent part was edited', () => {
    expect(leftoverAfterSave('고친 첫 메모', '첫 메모')).toBe('고친 첫 메모')
  })
})

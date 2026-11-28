import { describe, expect, it } from 'vitest'
import { ko } from '../../src/renderer/i18n/ko'

// 화면 기준(UI_STANDARD) 1·2장: 쓰지 않는 말이 화면 문구에 남지 않는다. ko.ts 의 모든 문구(함수 문구는 예시 값을 넣어 만든 글)를 훑는다.
function strings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (typeof value === 'function') {
    const make = value as (...args: unknown[]) => unknown
    // 글자·숫자·글자 목록 중 어느 인자를 받는지 모르니 몇 가지 예시로 만들어 본다.
    for (const args of [['항목', '항목', '항목'], [3, 3, 3], [['항목']]]) {
      try {
        const made = make(...args)
        if (typeof made === 'string') {
          out.push({ path, text: made })
          break
        }
      } catch {
        // 다음 예시로
      }
    }
  } else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${path}[${index}]`, out))
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) strings(item, `${path}.${key}`, out)
}

const BANNED: { word: RegExp; use: string }[] = [
  { word: /루틴/, use: '체크리스트 / 체크리스트 항목' },
  { word: /데일리 체크리스트|오늘의 체크리스트/, use: '체크리스트' },
  { word: /캘린더/, use: '달력 (Google 쪽은 "Google 캘린더")' },
  { word: /구글/, use: 'Google' },
  { word: /후보/, use: '들어온 할 일' },
  { word: /수정/, use: '편집 / 저장' },
  { word: /지우기|지우세요|지웠|지워|지운|지울/, use: '삭제' },
  { word: /지난 미완료/, use: '지난 할 일' }
]

describe('ko.ts uses the standard terms', () => {
  const all: { path: string; text: string }[] = []
  strings(ko, 'ko', all)

  it('has text to check', () => {
    expect(all.length).toBeGreaterThan(300)
  })

  it.each(BANNED)('no screen text contains $word', ({ word, use }) => {
    const found = all
      // 'Google 캘린더' 는 그대로 쓴다
      .map((entry) => ({ ...entry, text: entry.text.replaceAll('Google 캘린더', '') }))
      .filter((entry) => word.test(entry.text))
      .map((entry) => `${entry.path}: ${entry.text}  → ${use}`)
    expect(found).toEqual([])
  })

  it('the task detail long-text field is called 설명, and the batch-mode end button 배치 끝', () => {
    expect(ko.tasks.detail.notes).toBe('설명')
    expect(ko.home.doneArranging).toBe('배치 끝')
  })
})

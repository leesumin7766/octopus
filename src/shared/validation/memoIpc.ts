import { MAX_MEMO_LENGTH } from './memo'
import { bad, good, type Parsed } from './taskIpc'

export const MAX_SEARCH_LENGTH = 200

/** 메모 본문: 문자열이고 상한 이하. 비어 있는지는 저장소가 검사한다. */
export function parseMemoBody(value: unknown): Parsed<string> {
  return typeof value === 'string' && value.length <= MAX_MEMO_LENGTH ? good(value) : bad('body')
}

export function parseSearchQuery(value: unknown): Parsed<string> {
  return typeof value === 'string' && value.length <= MAX_SEARCH_LENGTH ? good(value) : bad('query')
}

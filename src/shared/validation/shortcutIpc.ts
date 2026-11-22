import type { AddUrlInput, MoveDirection, PathType } from '../shortcuts/types'
import { bad, good, isPlainObject, type Parsed } from './taskIpc'

// 바로가기 IPC 입력 검사. 값의 세부 검사(주소 형식·이름 길이)는 저장소가 한다.
// 렌더러가 경로 문자열을 보내는 채널은 없다. 경로는 main 의 파일 선택 대화상자로만 정해진다.

/** 링크 추가: { url: 문자열, label?: 문자열 } 만 허용 */
export function parseAddUrlInput(value: unknown): Parsed<AddUrlInput> {
  if (!isPlainObject(value)) return bad('input')
  if (!Object.keys(value).every((key) => key === 'url' || key === 'label')) return bad('input')
  if (typeof value['url'] !== 'string') return bad('url')
  if (value['label'] !== undefined && typeof value['label'] !== 'string') return bad('label')
  return good(value as unknown as AddUrlInput)
}

export function parsePathKind(value: unknown): Parsed<PathType> {
  return value === 'file' || value === 'folder' ? good(value) : bad('kind')
}

export function parseMoveDirection(value: unknown): Parsed<MoveDirection> {
  return value === 'up' || value === 'down' ? good(value) : bad('direction')
}

export function parseLabel(value: unknown): Parsed<string> {
  return typeof value === 'string' ? good(value) : bad('label')
}

import type { TranscriptItem } from '../../shared/command/types'
import { ko } from '../i18n/ko'

const t = ko.command

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

/** 도구의 사람이 읽는 이름 */
export function toolLabel(name: string): string {
  return t.toolLabels[name] ?? t.unknownTool(name)
}

/** 도구 한 번의 결과를 한 줄로. 읽기 도구는 "…봤어요", 쓰기 도구는 "… 완료/실패/거절함". */
export function toolLine(item: ToolItem): string {
  if (item.readOnly) {
    if (item.status === 'error') return t.toolError(toolLabel(item.name))
    return t.readLines[item.name] ?? t.readFallback(item.name)
  }
  if (item.status === 'rejected') return t.toolRejected(toolLabel(item.name))
  if (item.status === 'error') return t.toolError(toolLabel(item.name))
  return t.toolDone(toolLabel(item.name))
}

/** 오류 종류별 안내 문구 */
export function errorText(kind: string): string {
  return t.errors[kind] ?? t.errors.unknown
}

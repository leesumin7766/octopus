import type { TaskView } from './tasks/types'
import { parseView } from './validation/taskIpc'

/** main 이 개발용 캡처 때 창에 넘기는 인자 이름. 평소에는 쓰지 않는다. */
export const INITIAL_VIEW_ARG = '--octopus-initial-view='

export function initialViewArgument(view: TaskView): string {
  return `${INITIAL_VIEW_ARG}${view}`
}

/** preload 가 process.argv 에서 처음 보여 줄 보기를 읽는다. 없거나 틀리면 null. */
export function readInitialView(argv: readonly string[]): TaskView | null {
  const arg = argv.find((a) => a.startsWith(INITIAL_VIEW_ARG))
  if (arg === undefined) return null
  const parsed = parseView(arg.slice(INITIAL_VIEW_ARG.length))
  return parsed.ok ? parsed.value : null
}

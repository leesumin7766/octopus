import type { TaskView } from './tasks/types'
import { parseView } from './validation/taskIpc'

/**
 * 앱이 처음 보여 줄 화면: 할 일의 보기 5종, 체크리스트, 메모, 홈, 배치 모드가 켜진 홈.
 * 개발용 캡처에서만 쓴다(평소에는 null 이고 홈으로 시작한다).
 */
export type InitialView = TaskView | 'routines' | 'memos' | 'home' | 'home-arrange' | 'home-pie' | 'home-narrow' | 'settings' | 'command' | 'command-nokey' | 'arms' | 'arms-mcp' | 'obsidian' | 'welcome-1' | 'welcome-2' | 'welcome-3'

const EXTRA_VIEWS: readonly unknown[] = ['routines', 'memos', 'home', 'home-arrange', 'home-pie', 'home-narrow', 'settings', 'command', 'command-nokey', 'arms', 'arms-mcp', 'obsidian', 'welcome-1', 'welcome-2', 'welcome-3']

/** main 이 개발용 캡처 때 창에 넘기는 인자 이름. 평소에는 쓰지 않는다. */
export const INITIAL_VIEW_ARG = '--octopus-initial-view='

/** 값이 처음 화면으로 쓸 수 있는 것이면 돌려주고, 아니면 null. */
export function parseInitialView(value: unknown): InitialView | null {
  if (EXTRA_VIEWS.includes(value)) return value as InitialView
  const view = parseView(value)
  return view.ok ? view.value : null
}

export function initialViewArgument(view: InitialView): string {
  return `${INITIAL_VIEW_ARG}${view}`
}

/** preload 가 process.argv 에서 처음 보여 줄 화면을 읽는다. 없거나 틀리면 null. */
export function readInitialView(argv: readonly string[]): InitialView | null {
  const arg = argv.find((a) => a.startsWith(INITIAL_VIEW_ARG))
  return arg === undefined ? null : parseInitialView(arg.slice(INITIAL_VIEW_ARG.length))
}

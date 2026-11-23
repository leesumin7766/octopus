import type { BrowserWindow, Dialog } from 'electron'

// MCP stdio 서버를 처음 실행하기 전 확인 창. 실행할 명령과 인자 전체를 그대로 보여 주고, 기본 선택은 "취소"다.

export interface CommandConfirmInfo {
  name: string
  command: string
  args: string[]
}

const TEXT = {
  title: '프로그램 실행 확인',
  message: (name: string) => `MCP 서버 "${name}" 이(가) 아래 프로그램을 실행하려고 해요. 실행할까요?`,
  commandLabel: '명령',
  argLabel: (n: number) => `인자 ${n}`,
  noArgs: '인자 없음',
  warning: '이 프로그램은 이 PC 에서 내 권한으로 실행돼요. 직접 입력했거나 믿을 수 있는 것인지 확인해 주세요.',
  run: '실행',
  cancel: '취소'
} as const

/** 확인 창 본문: 명령과 인자를 줄마다 하나씩, 가공 없이 보여 준다(공백·특수문자도 그대로). */
export function describeCommand(command: string, args: readonly string[]): string {
  const lines = [`${TEXT.commandLabel}: ${command}`]
  if (args.length === 0) lines.push(TEXT.noArgs)
  args.forEach((arg, i) => lines.push(`${TEXT.argLabel(i + 1)}: ${arg}`))
  return `${lines.join('\n')}\n\n${TEXT.warning}`
}

export interface CommandConfirmDeps {
  dialog: Pick<Dialog, 'showMessageBox'>
  getWindow: () => BrowserWindow | null
}

/** 사용자가 [실행]을 눌렀을 때만 true. 창을 닫거나 Esc 를 눌러도, 기본 선택(취소)이어도 false. */
export function createCommandConfirm(deps: CommandConfirmDeps): (info: CommandConfirmInfo) => Promise<boolean> {
  return async (info) => {
    const options = {
      type: 'warning' as const,
      title: TEXT.title,
      message: TEXT.message(info.name),
      detail: describeCommand(info.command, info.args),
      buttons: [TEXT.cancel, TEXT.run],
      defaultId: 0, // 기본 선택은 취소
      cancelId: 0,
      noLink: true
    }
    const window = deps.getWindow()
    const result = window ? await deps.dialog.showMessageBox(window, options) : await deps.dialog.showMessageBox(options)
    return result.response === 1
  }
}

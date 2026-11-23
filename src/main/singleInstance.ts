/** Electron 의 app 중 쓰는 부분(시험에서는 가짜를 넣는다) */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
}

export interface WindowLike {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * 한 번에 한 개만 실행한다(같은 DB 를 두 프로세스가 열지 않게).
 * 이미 실행 중이면 이 프로세스는 곧 끝나고(false), 먼저 떠 있던 쪽이 'second-instance' 를 받아 기존 창을 앞으로 가져온다.
 * exempt(개발용 캡처)는 임시 userData 를 따로 쓰므로 충돌이 없어 잠금을 쓰지 않는다 — 캡처를 개발 중인 앱이 떠 있어도 찍을 수 있게.
 * 돌려주는 값: 이 프로세스가 계속 실행해도 되는지.
 */
export function acquireSingleInstance(app: SingleInstanceApp, getWindow: () => WindowLike | null, exempt: boolean): boolean {
  if (exempt) return true
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  return true
}

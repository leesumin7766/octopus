import { pathToFileURL } from 'node:url'

// 창 보안 보강: 새 창을 열지 못하게 하고, 앱 화면(개발 서버 주소 또는 앱의 index.html) 밖으로 이동하지 못하게 한다.
// 바깥 주소는 지금처럼 main 이 검증해서 여는 IPC(바로가기·후보 원본·일정 등)로만 열린다.

export interface GuardOptions {
  /** 개발 서버 주소(electron-vite dev 일 때만 있다) */
  devUrl?: string
  /** 앱 화면 파일 경로(패키지·빌드 실행) */
  indexFilePath: string
}

/** 이 주소로 이동해도 되는지: 개발 서버와 같은 출처, 또는 앱의 index.html (해시·쿼리만 다른 것 포함). */
export function isAppNavigation(target: string, options: GuardOptions): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (options.devUrl) {
    try {
      if (url.origin !== 'null' && url.origin === new URL(options.devUrl).origin) return true
    } catch {
      // 잘못된 개발 서버 주소는 무시하고 파일 비교로 넘어간다.
    }
  }
  if (url.protocol !== 'file:') return false
  const index = pathToFileURL(options.indexFilePath)
  return url.pathname.toLowerCase() === index.pathname.toLowerCase() // Windows 는 대소문자를 구분하지 않는다
}

/** Electron webContents 중 쓰는 부분(시험에서는 가짜를 넣는다) */
export interface GuardableWebContents {
  setWindowOpenHandler(handler: () => { action: 'deny' }): void
  on(event: 'will-navigate' | 'will-redirect', listener: (event: { preventDefault(): void; url: string }) => void): unknown
}

/** 새 창은 모두 막고, 앱 밖으로의 이동(링크 클릭·스크립트·리다이렉트)은 preventDefault 한다. */
export function guardWindow(contents: GuardableWebContents, options: GuardOptions): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const block = (event: { preventDefault(): void; url: string }): void => {
    if (!isAppNavigation(event.url, options)) event.preventDefault()
  }
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
}

// BrowserWindow 보안 옵션. main 과 테스트가 함께 쓰는 순수 함수.
export interface WebPreferences {
  preload: string
  contextIsolation: true
  nodeIntegration: false
  sandbox: true
}

export function buildWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
}

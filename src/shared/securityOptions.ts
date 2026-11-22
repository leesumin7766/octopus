// BrowserWindow 보안 옵션. main 과 테스트가 함께 쓰는 순수 함수.
export interface WebPreferences {
  preload: string
  contextIsolation: true
  nodeIntegration: false
  sandbox: true
  /** 렌더러의 process.argv 로 넘길 인자. 비어 있으면 키 자체를 넣지 않는다. */
  additionalArguments?: string[]
}

export function buildWebPreferences(preloadPath: string, additionalArguments: readonly string[] = []): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    ...(additionalArguments.length > 0 ? { additionalArguments: [...additionalArguments] } : {})
  }
}

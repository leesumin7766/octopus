import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

// jsdom(브라우저형) 환경의 Vite 는 'node:sqlite' 를 내장 모듈로 알아보지 못한다.
// 화면 테스트가 진짜 저장소(메모리 DB)를 뒤에 두고 돌 수 있도록 외부 모듈로 표시한다.
const externalNodeSqlite: Plugin = {
  name: 'external-node-sqlite',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'node:sqlite') return { id, external: true }
    return null
  }
}

// 기본 테스트 환경은 node. 화면(renderer) 테스트 파일만 맨 위에 `// @vitest-environment jsdom` 을 적는다.
export default defineConfig({
  plugins: [react(), externalNodeSqlite],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // 시험이 많이 겹쳐 돌 때(전체 실행·CI) 한 시험이 느려져도 떨어지지 않게 시간 제한을 넉넉히 둔다. 진짜 서버 시험(tests/net)도 같다.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})

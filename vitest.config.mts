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
    include: ['tests/**/*.test.{ts,tsx}']
  }
})

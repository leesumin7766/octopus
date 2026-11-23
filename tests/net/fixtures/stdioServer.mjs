// @ts-nocheck
// 시험용 stdio MCP 서버: node 로 실행한다. 인자(argv.slice(2))는 'argv' 도구가 그대로 돌려준다.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createFixtureServer } from './mcpFixture.mjs'

const server = createFixtureServer()
await server.connect(new StdioServerTransport())

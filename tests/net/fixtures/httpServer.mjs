// @ts-nocheck
// 시험용 HTTP(Streamable HTTP) MCP 서버: 127.0.0.1 의 임의 포트. 요청마다 서버와 전송을 새로 만든다(상태 없음).
import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createFixtureServer } from './mcpFixture.mjs'

export async function startHttpFixture() {
  const hits = []
  const http = createServer(async (req, res) => {
    hits.push(`${req.method} ${req.url}`)
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const server = createFixtureServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
  })
  await new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  return { url: `http://127.0.0.1:${http.address().port}/mcp`, hits, close: () => new Promise((r) => (http.closeAllConnections?.(), http.close(r))) }
}

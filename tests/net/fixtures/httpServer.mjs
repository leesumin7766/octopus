// @ts-nocheck
// 시험용 HTTP(Streamable HTTP) MCP 서버: 127.0.0.1 의 임의 포트. 요청마다 서버와 전송을 새로 만든다(상태 없음).
import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createFixtureServer } from './mcpFixture.mjs'

export async function startHttpFixture() {
  const hits = []
  const handler = async (req, res) => {
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
  }
  // 이 PC 의 네트워크 계층이 가끔 listen 을 EFAULT 로 거절한다(테스트 환경의 문제). 서버를 새로 만들어 다시 시도한다.
  let http
  for (let attempt = 0; ; attempt++) {
    http = createServer(handler)
    try {
      await new Promise((resolve, reject) => {
        http.once('error', reject)
        http.listen(0, '127.0.0.1', resolve)
      })
      break
    } catch (error) {
      http.close()
      if (attempt >= 25) throw error
      await new Promise((r) => setTimeout(r, 60))
    }
  }
  return { url: `http://127.0.0.1:${http.address().port}/mcp`, hits, close: () => new Promise((r) => (http.closeAllConnections?.(), http.close(r))) }
}

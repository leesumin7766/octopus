// @ts-nocheck
// 시험용 가짜 MCP 서버(공식 SDK 의 Server). 바깥으로 나가지 않는다.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const obj = (properties = {}) => ({ type: 'object', properties })

/** 도구 둘(읽기 힌트 있음 / 없음)에 더해 시험용 도구 몇 개 */
export function createFixtureServer({ argv = process.argv, env = process.env } = {}) {
  const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  const extra = []

  const tools = () => [
    { name: 'echo', description: '받은 글자를 그대로 돌려줘요.', inputSchema: obj({ text: { type: 'string' } }), annotations: { readOnlyHint: true } },
    { name: 'write_note', description: '노트를 써요.', inputSchema: obj({ title: { type: 'string' }, body: { type: 'string' } }) },
    { name: 'explicit_write', description: '쓰기라고 밝힌 도구', inputSchema: obj(), annotations: { readOnlyHint: false } },
    { name: 'big', description: '아주 긴 글자를 돌려줘요.', inputSchema: obj({ bytes: { type: 'number' } }), annotations: { readOnlyHint: true } },
    { name: 'slow', description: '오래 걸려요.', inputSchema: obj({ ms: { type: 'number' } }), annotations: { readOnlyHint: true } },
    { name: 'picture', description: '그림을 돌려줘요.', inputSchema: obj(), annotations: { readOnlyHint: true } },
    { name: 'fail', description: '오류를 알려요.', inputSchema: obj(), annotations: { readOnlyHint: true } },
    { name: 'argv', description: '프로세스 인자를 돌려줘요.', inputSchema: obj(), annotations: { readOnlyHint: true } },
    { name: 'env', description: '환경 변수를 돌려줘요.', inputSchema: obj({ name: { type: 'string' } }), annotations: { readOnlyHint: true } },
    { name: 'env_names', description: '환경 변수 이름들을 돌려줘요.', inputSchema: obj(), annotations: { readOnlyHint: true } },
    { name: 'crash', description: '서버를 끝내요.', inputSchema: obj() },
    { name: 'add_tool', description: '도구를 하나 더 만들어요.', inputSchema: obj(), annotations: { readOnlyHint: true } },
    { name: 'weird/name with spaces', description: '이름에 이상한 글자가 있어요.', inputSchema: obj(), annotations: { readOnlyHint: true } },
    ...extra
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools() }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: a = {} } = request.params
    const text = (t) => ({ content: [{ type: 'text', text: t }] })
    switch (name) {
      case 'echo':
        return text(`echo: ${a.text}`)
      case 'write_note':
        return text(`wrote: ${a.title}`)
      case 'explicit_write':
        return text('written')
      case 'big':
        return text('가'.repeat(Math.ceil((a.bytes ?? 100000) / 3)))
      case 'slow':
        await new Promise((r) => setTimeout(r, a.ms ?? 5000))
        return text('finally')
      case 'picture':
        return { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: '캡션' }] }
      case 'fail':
        return { isError: true, content: [{ type: 'text', text: '일이 잘못됐어요' }] }
      case 'argv':
        return text(JSON.stringify(argv.slice(2)))
      case 'env':
        return text(String(env[a.name] ?? ''))
      case 'env_names':
        return text(JSON.stringify(Object.keys(env)))
      case 'crash':
        setTimeout(() => process.exit(3), 10)
        return text('bye')
      case 'add_tool':
        extra.push({ name: 'added_later', description: '나중에 생긴 도구', inputSchema: obj(), annotations: { readOnlyHint: true } })
        setTimeout(() => void server.sendToolListChanged(), 20)
        return text('added')
      default:
        return text(`unknown ${name}`)
    }
  })
  return server
}

import type { Arm } from '../arms/sdk/types'
import { ArmError } from '../arms/sdk/types'
import type { InitialView } from '../../shared/initialView'

// 개발용 화면 캡처에서만 등록하는 가짜 Arm. 특정 회사·도구를 가리키지 않는 중립 이름을 쓴다.
// 진짜 로그인·네트워크는 쓰지 않는다. 캡처 모드(배포 앱 아님)가 아니면 등록되지 않는다.

/** 이 화면들에서만 가짜 Arm 을 등록한다. */
export const CAPTURE_ARM_VIEWS: readonly InitialView[] = ['arms', 'arms-mcp', 'inbox']

/** 상태 'on' 인 가짜 Arm. 연결되면 수신함 후보 3개를 보낸다. */
export function createExampleArm(): Arm {
  let ctxCore: { addInboxCandidate: (c: { ref: string; title: string; notes?: string; url?: string; dueDate?: string }) => unknown } | null = null
  return {
    manifest: {
      id: 'example',
      name: '예시 Arm',
      version: '0.1.0',
      auth: 'oauth',
      scopes: ['example.read'],
      capabilities: ['tasks.import', 'links', 'command.tools'],
      description: '화면 구성을 보여 주기 위한 예시예요. 실제 도구와 연결되지 않아요.'
    },
    async connect(ctx) {
      ctxCore = ctx.core
    },
    async disconnect() {
      ctxCore = null
    },
    status: () => ({ state: 'on' }),
    async sync() {
      const core = ctxCore
      if (!core) return { added: 0 }
      core.addInboxCandidate({ ref: 'item-1', title: '팀 회의 안건 정리해서 공유하기', notes: '목요일 회의 전까지', url: 'https://example.com/items/1' })
      core.addInboxCandidate({ ref: 'item-2', title: '견적서 회신하기', url: 'https://example.com/items/2', dueDate: '2026-11-27' })
      core.addInboxCandidate({ ref: 'item-3', title: '월말 정산 자료 확인', notes: '숫자가 맞는지 두 번 확인' })
      return { added: 3 }
    }
  }
}

/** 연결에 실패해 'error' 상태로 보이는 가짜 Arm */
export function createBrokenExampleArm(): Arm {
  return {
    manifest: {
      id: 'example-two',
      name: '예시 Arm 2',
      version: '0.1.0',
      auth: 'apiKey',
      capabilities: ['events.read', 'home.card'],
      description: '오류 상태가 어떻게 보이는지 보여 주는 예시예요.'
    },
    async connect() {
      throw new ArmError('로그인이 만료됐어요. [다시 연결]을 눌러 다시 로그인해 주세요.')
    },
    async disconnect() {},
    status: () => ({ state: 'off' })
  }
}

/** 캡처 모드의 비밀 저장소: 메모리에만 있고 파일을 만들지 않는다. */
export function createMemorySecureStore(): import('../platform/secureStore').SecureStore {
  const data = new Map<string, Map<string, string>>()
  return {
    get: (ns, key) => data.get(ns)?.get(key),
    set(ns, key, value) {
      const entries = data.get(ns) ?? new Map<string, string>()
      entries.set(key, value)
      data.set(ns, entries)
    },
    delete: (ns, key) => void data.get(ns)?.delete(key),
    deleteNamespace: (ns) => void data.delete(ns)
  }
}

/** 캡처 모드(home)의 가짜 캘린더: 지금 시각을 기준으로 종일 1 · 진행 중 1 · 예정 1. 중립적인 제목. */
export function createCaptureCalendar(): import('../arms/google-calendar/provider').CalendarProvider {
  const events = () => {
    const now = Date.now()
    const at = (minutes: number): string => new Date(now + minutes * 60_000).toISOString()
    const today = new Date().toLocaleDateString('sv-SE')
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE')
    return [
      { id: 'cap-1', title: '월간 마감일', start: today, end: tomorrow, allDay: true, url: 'https://calendar.example.com/e/1' },
      { id: 'cap-2', title: '팀 정기 회의', start: at(-30), end: at(30), allDay: false, url: 'https://calendar.example.com/e/2' },
      { id: 'cap-3', title: '점심 약속', start: at(120), end: at(180), allDay: false, url: null }
    ]
  }
  return {
    today: () => ({ configured: true, status: { state: 'on' }, events: events() }),
    findEvent: (id) => events().find((e) => e.id === id)
  }
}

/** 캡처 모드의 가짜 MCP 연결: 서버 이름·명령에 따라 도구 2개를 주거나(연결됨), 실행 실패로 끝난다(오류). 진짜 서버는 띄우지 않는다. */
export function createCaptureMcpConnector(): import('../arms/mcp/connection').McpConnector {
  return async (options) => {
    const { McpSpawnError } = await import('../arms/mcp/connection')
    if (options.transport.kind === 'stdio' && options.transport.command === 'missing-server') throw new McpSpawnError()
    const tools = [
      { name: 'search_notes', description: '노트에서 글자를 찾아요.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: { readOnlyHint: true } },
      { name: 'create_page', description: '새 페이지를 만들어요.', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }
    ]
    return { tools: () => tools, callTool: async () => ({ content: [] }), close: async () => {}, pid: () => null }
  }
}

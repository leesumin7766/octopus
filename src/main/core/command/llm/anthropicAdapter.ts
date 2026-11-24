import type Anthropic from '@anthropic-ai/sdk'
import type { ContentBlock, StopReason } from '../../../../shared/command/types'
import { LlmError, statusToKind, type ChatRequest, type ChatResponse, type LlmAdapter } from './types'

/**
 * 어댑터가 쓰는 SDK 클라이언트 부분. 가짜가 아니라 실제 SDK 의 형(Pick<Anthropic, …>)이라서,
 * 요청 파라미터·스트림 이벤트·옵션이 SDK 시그니처와 맞는지 typecheck 가 검사한다.
 */
export type AnthropicClientLike = Pick<Anthropic, 'messages' | 'beta'>

type PlainParams = Parameters<Anthropic['messages']['stream']>[0]
type BetaParams = Parameters<Anthropic['beta']['messages']['stream']>[0]
type BetaNonStreamingParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
type PlainNonStreamingParams = Anthropic.Messages.MessageCreateParamsNonStreaming

/** 응답에서 어댑터가 읽는 부분(실제 SDK 의 Message·BetaMessage 가 그대로 들어맞는다). */
export interface AnthropicResponse {
  content: ReadonlyArray<{ type: string }>
  stop_reason: string | null
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null
}

export interface AnthropicAdapterOptions {
  client: AnthropicClientLike
  model: string
  effort?: 'low' | 'medium' | 'high'
  /** 생략하면 스트리밍은 64000, 한 번에 받을 때는 16000 */
  maxTokens?: number
  /** 서버 쪽 대체 모델(fallback). 기본 켜짐. Haiku 5.5 에는 보내지 않는다. */
  fallbacks?: boolean
  /** 스트리밍 중 이 시간(ms) 동안 아무 이벤트도 오지 않으면 멈추고 network 오류로 끝낸다. 기본 STREAM_IDLE_MS. */
  idleMs?: number
}

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** 스트리밍은 긴 출력을 허용하므로 기본 한도를 넉넉히(한 번에 받는 경로는 16000 을 넘기면 SDK 가 거절한다). */
export const STREAMING_MAX_TOKENS = 64000
export const PLAIN_MAX_TOKENS = 16000

/**
 * 스트림 무응답 제한(ms). SDK 의 timeout(클라이언트 120초)은 응답 헤더를 받을 때까지만 걸리고 본문 스트림에는 걸리지 않는다
 * (node_modules/@anthropic-ai/sdk/client.js 의 fetchWithTimeout: fetch 가 돌아오면 타이머를 지운다).
 * 그래서 헤더를 받은 뒤 이 시간 동안 이벤트가 하나도 없으면 우리가 끊는다.
 */
export const STREAM_IDLE_MS = 90_000

function supportsFallbacks(model: string): boolean {
  return !model.startsWith('claude-haiku-5-5')
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'other'
  }
}

/** 대화 블록 → SDK 가 받는 블록. opaque(thinking·fallback 등)는 고치지 않고 그대로 돌려보낸다. */
function toWire(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: block.toolUseId, content: block.content, ...(block.isError ? { is_error: true } : {}) }
    case 'opaque':
      return block.raw as Record<string, unknown> // thinking 블록 등은 고치지 않고 그대로
  }
}

function fromWire(block: { type: string }): ContentBlock {
  const raw = block as unknown as Record<string, unknown>
  if (block.type === 'text') return { type: 'text', text: String(raw.text ?? '') }
  if (block.type === 'tool_use') return { type: 'tool_use', id: String(raw.id), name: String(raw.name), input: raw.input }
  // fallback 블록처럼 모르는 블록은 고치지 않고 보관해 다음 요청에 그대로 돌려보낸다.
  return { type: 'opaque', provider: 'anthropic', raw: block }
}

/** 응답 한 개를 공통 모양으로 */
function mapResponse(response: AnthropicResponse): ChatResponse {
  return {
    content: response.content.map(fromWire),
    stopReason: mapStop(response.stop_reason),
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }
  }
}

/** 스트림 도중 연결이 끊길 때 던져지는, SDK 오류 모양이 아닌 예외(undici 의 'terminated' 등)인지 */
function looksLikeDroppedConnection(error: unknown): boolean {
  const e = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null
  const code = e?.code ?? e?.cause?.code
  if (typeof code === 'string' && /^(ECONNRESET|ECONNABORTED|EPIPE|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|UND_ERR_)/.test(code)) return true
  return e?.name === 'TypeError' && typeof e.message === 'string' && /terminated|fetch failed|network/i.test(e.message)
}

/** SDK 오류를 모양만 보고 분류한다(연결 오류를 상태 오류보다 먼저). 원문 메시지는 버린다. */
export function classifyAnthropicError(error: unknown): LlmError {
  if (error instanceof LlmError) return error
  const e = error as { name?: string; status?: number } | null
  const name = e?.name ?? ''
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return new LlmError('network', 'network error')
  if (name === 'APIUserAbortError') return new LlmError('unknown', 'aborted')
  if (typeof e?.status === 'number') return new LlmError(statusToKind(e.status), `api status ${e.status}`)
  if (looksLikeDroppedConnection(error)) return new LlmError('network', 'network error')
  return new LlmError('unknown', 'unexpected error')
}

/** 실제 SDK 스트림(일반·베타) 중 어댑터가 쓰는 부분 */
interface TextStream {
  on(event: 'text', listener: (textDelta: string, snapshot: string) => void): unknown
  /** 응답 헤더를 받았다 */
  on(event: 'connect', listener: () => void): unknown
  /** 스트림 이벤트가 하나 왔다(글·생각·도구 입력·ping 모두) */
  on(event: 'streamEvent', listener: () => void): unknown
  finalMessage(): Promise<AnthropicResponse>
}

export function createAnthropicAdapter(options: AnthropicAdapterOptions): LlmAdapter {
  const useFallbacks = (options.fallbacks ?? true) && supportsFallbacks(options.model)
  const idleMs = options.idleMs ?? STREAM_IDLE_MS

  /**
   * 요청 내용(일반/베타 SDK 가 같은 필드 이름·모양으로 받는다)을 만든다.
   * 대화 블록(opaque 포함)과 바깥 도구의 JSON Schema 는 SDK 의 엄격한 블록 형으로 좁힐 수 없어 이 두 곳에서만 형을 맞춘다.
   */
  function buildCore(request: ChatRequest, defaultMaxTokens: number) {
    const messages = request.messages.map((m) => ({ role: m.role, content: m.content.map(toWire) }))
    const tools = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, ...(t.strict === false ? {} : { strict: true }) }))
    return {
      model: options.model,
      max_tokens: options.maxTokens ?? defaultMaxTokens,
      system: request.system,
      messages,
      // 강제 호출(tool_choice any/tool)은 Opus/Sonnet 5.5 에서 400 이라 auto 만 쓴다(기본값이지만 명시).
      tool_choice: { type: 'auto' as const },
      ...(options.effort ? { output_config: { effort: options.effort } } : {}),
      // eager_input_streaming 은 켜지 않는다: 우리 도구 입력은 작아서 조각으로 받을 이득이 없고,
      // strict: true 의 서버 쪽 입력 검증(스키마 보장)을 그대로 쓰려면 입력이 완성된 뒤에 받는 편이 맞다.
      ...(tools.length > 0 ? { tools } : {})
    }
  }
  type Core = ReturnType<typeof buildCore>
  // 같은 내용을 SDK 의 호출마다 그 호출이 받는 형으로 건넨다(스트림·한 번에 받기는 output_config 의 형이 조금 다르다).
  const asPlain = (core: Core): PlainParams => core as unknown as PlainParams
  const asBeta = (core: Core): BetaParams => ({ ...(core as unknown as BetaParams), betas: [FALLBACK_BETA], fallbacks: 'default' })
  const asPlainCreate = (core: Core): PlainNonStreamingParams => ({ ...(core as unknown as PlainNonStreamingParams), stream: false })
  const asBetaCreate = (core: Core): BetaNonStreamingParams => ({ ...(core as unknown as BetaNonStreamingParams), betas: [FALLBACK_BETA], fallbacks: 'default', stream: false })

  async function plain(request: ChatRequest): Promise<ChatResponse> {
    const core = buildCore(request, PLAIN_MAX_TOKENS)
    try {
      const response = useFallbacks
        ? await options.client.beta.messages.create(asBetaCreate(core))
        : await options.client.messages.create(asPlainCreate(core))
      return mapResponse(response)
    } catch (error) {
      throw classifyAnthropicError(error)
    }
  }

  async function streaming(request: ChatRequest, onText: (text: string) => void): Promise<ChatResponse> {
    const { signal } = request
    const aborted = (partial: string): ChatResponse => ({
      content: partial === '' ? [] : [{ type: 'text', text: partial }],
      stopReason: 'other',
      usage: { inputTokens: 0, outputTokens: 0 },
      aborted: true
    })
    if (signal?.aborted) return aborted('')

    const core = buildCore(request, STREAMING_MAX_TOKENS)
    // 멈췄을 때만 쓰는, 그때까지 받은 글. 완성된 메시지는 항상 SDK 의 finalMessage() 가 준다.
    let partial = ''
    // 사용자의 중지(signal)와 우리의 무응답 제한을 한 컨트롤러로 모아 SDK 에 건넨다.
    const controller = new AbortController()
    const onUserAbort = (): void => controller.abort()
    signal?.addEventListener('abort', onUserAbort, { once: true })
    let stalled = false
    let idle: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        stalled = true
        controller.abort()
      }, idleMs)
    }
    try {
      // 일반/베타 스트림은 서로 다른 클래스라, 쓰는 메서드만 같은 모양으로 본다(호출 자체는 각자의 실제 SDK 시그니처로 검사된다).
      const stream: TextStream = useFallbacks
        ? options.client.beta.messages.stream(asBeta(core), { signal: controller.signal })
        : options.client.messages.stream(asPlain(core), { signal: controller.signal })
      // 헤더를 받은 뒤부터 센다(그 앞은 SDK 의 120초 timeout 이 맡는다). 이벤트가 올 때마다 다시 센다.
      stream.on('connect', arm)
      stream.on('streamEvent', arm)
      stream.on('text', (delta) => {
        partial += delta
        onText(delta)
      })
      return mapResponse(await stream.finalMessage())
    } catch (error) {
      // 무응답으로 우리가 끊은 것은 사용자의 중지가 아니라 네트워크 문제다.
      if (stalled && !signal?.aborted) throw new LlmError('no_response', 'stream stalled')
      if (signal?.aborted || (error as { name?: string } | null)?.name === 'APIUserAbortError') return aborted(partial)
      throw classifyAnthropicError(error)
    } finally {
      clearTimeout(idle)
      signal?.removeEventListener('abort', onUserAbort)
    }
  }
  return {
    chat(request: ChatRequest): Promise<ChatResponse> {
      return request.onText ? streaming(request, request.onText) : plain(request)
    }
  }
}

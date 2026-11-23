import { describe, expect, it, vi } from 'vitest'
import { createAnthropicAdapter, FALLBACK_BETA, type AnthropicClientLike, type AnthropicResponse } from '../../src/main/core/command/llm/anthropicAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'

const ok: AnthropicResponse = {
  content: [
    { type: 'thinking', thinking: 'hmm', signature: 'sig' },
    { type: 'text', text: '안녕' },
    { type: 'tool_use', id: 'tu_1', name: 'list_tasks', input: { view: 'inbox' } }
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 5 }
}

function fakeClient(response: AnthropicResponse | Error = ok) {
  const call = (p: Record<string, unknown>) => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))
  const plain = vi.fn(call)
  const beta = vi.fn(call)
  return { client: { messages: { create: plain }, beta: { messages: { create: beta } } } as AnthropicClientLike, plain, beta }
}

const request = {
  system: 'sys',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
  tools: [{ name: 'list_tasks', description: 'd', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }]
}

describe('anthropic adapter', () => {
  it('sends model, effort, auto tool choice, strict tools and the fallback beta by default', async () => {
    const f = fakeClient()
    await createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5', effort: 'medium' }).chat(request)

    expect(f.plain).not.toHaveBeenCalled()
    const params = f.beta.mock.calls[0][0]
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'sys',
      output_config: { effort: 'medium' },
      tool_choice: { type: 'auto' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default'
    })
    expect((params.tools as { strict: boolean; input_schema: unknown }[])[0]).toMatchObject({ name: 'list_tasks', strict: true })
    expect('thinking' in params).toBe(false)
  })

  it('asks for 16000 output tokens by default (the non-streaming recommendation)', async () => {
    const f = fakeClient()
    await createAnthropicAdapter({ client: f.client, model: 'claude-opus-5-5' }).chat(request)
    expect(f.beta.mock.calls[0][0].max_tokens).toBe(16000)
  })

  it('can turn fallbacks off, and never sends them for Haiku 5.5', async () => {
    const off = fakeClient()
    await createAnthropicAdapter({ client: off.client, model: 'claude-opus-5-5', fallbacks: false }).chat(request)
    expect(off.beta).not.toHaveBeenCalled()
    expect('fallbacks' in off.plain.mock.calls[0][0]).toBe(false)
    expect('output_config' in off.plain.mock.calls[0][0]).toBe(false)

    const haiku = fakeClient()
    await createAnthropicAdapter({ client: haiku.client, model: 'claude-haiku-5-5' }).chat(request)
    expect(haiku.beta).not.toHaveBeenCalled()
    expect(haiku.plain).toHaveBeenCalledTimes(1)
  })

  it('maps the response: text, tool_use, thinking kept opaque, stop reason, usage', async () => {
    const r = await createAnthropicAdapter({ client: fakeClient().client, model: 'm' }).chat(request)

    expect(r.stopReason).toBe('tool_use')
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(r.content).toEqual([
      { type: 'opaque', provider: 'anthropic', raw: { type: 'thinking', thinking: 'hmm', signature: 'sig' } },
      { type: 'text', text: '안녕' },
      { type: 'tool_use', id: 'tu_1', name: 'list_tasks', input: { view: 'inbox' } }
    ])
  })

  it('sends opaque blocks back unchanged, and tool results as tool_result blocks in one user message', async () => {
    const f = fakeClient()
    const raw = { type: 'thinking', thinking: 'hmm', signature: 'sig' }
    await createAnthropicAdapter({ client: f.client, model: 'm', fallbacks: false }).chat({
      ...request,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'opaque', provider: 'anthropic', raw }, { type: 'tool_use', id: 'a', name: 'x', input: {} }, { type: 'tool_use', id: 'b', name: 'y', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: 'A' }, { type: 'tool_result', toolUseId: 'b', content: 'B', isError: true }] }
      ]
    })

    const sent = f.plain.mock.calls[0][0].messages as { role: string; content: Record<string, unknown>[] }[]
    expect(sent[1].content[0]).toEqual(raw)
    expect(sent[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'A' },
      { type: 'tool_result', tool_use_id: 'b', content: 'B', is_error: true }
    ])
  })

  it.each([
    ['stop_sequence', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['model_context_window_exceeded', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other']
  ])('maps stop reason %s to %s', async (from, to) => {
    const f = fakeClient({ content: [], stop_reason: from })
    expect((await createAnthropicAdapter({ client: f.client, model: 'm' }).chat(request)).stopReason).toBe(to)
  })

  it.each([
    [{ name: 'APIConnectionError', message: 'secret-key-sk-123' }, 'network'],
    [{ name: 'APIConnectionTimeoutError', message: 'x' }, 'network'],
    [{ name: 'AuthenticationError', status: 401, message: 'x' }, 'auth'],
    [{ name: 'RateLimitError', status: 429, message: 'x' }, 'rate_limit'],
    [{ name: 'InternalServerError', status: 529, message: 'x' }, 'overloaded'],
    [{ name: 'BadRequestError', status: 400, message: 'x' }, 'bad_request'],
    [{ name: 'Error', message: 'x' }, 'unknown']
  ])('classifies %j as %s without leaking the original message', async (props, kind) => {
    const f = fakeClient(Object.assign(new Error(String(props.message)), props))
    const error = await createAnthropicAdapter({ client: f.client, model: 'm' }).chat(request).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe(kind)
    expect((error as LlmError).message).not.toContain('secret-key')
  })
})

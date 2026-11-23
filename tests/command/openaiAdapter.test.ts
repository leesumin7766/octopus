import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAdapter, type FetchLike } from '../../src/main/core/command/llm/openaiCompatibleAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'

const request = {
  system: 'sys',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
  tools: [{ name: 'list_tasks', description: 'd', inputSchema: { type: 'object', properties: {} } }]
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<FetchLike>(async () => ({ ok: status < 400, status, json: async () => body }))
}

describe('openai-compatible adapter', () => {
  it('posts to {baseUrl}/chat/completions with a bearer key, tools and tool_choice auto', async () => {
    const fetch = fakeFetch({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'https://x.test/v1/', model: 'gpt', apiKey: 'K' }).chat(request)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://x.test/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer K')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'list_tasks', description: 'd', parameters: request.tools[0].inputSchema } })
    expect(body.tool_choice).toBe('auto')
  })

  it('asks for 16000 output tokens by default', async () => {
    const fetch = fakeFetch({ choices: [{ message: { content: 'ok' } }] })
    await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'u', model: 'm', apiKey: '' }).chat(request)
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(16000)
  })

  it('sends no authorization header when there is no key (local servers)', async () => {
    const fetch = fakeFetch({ choices: [{ message: { content: 'ok' } }] })
    await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'http://localhost:1234/v1', model: 'm', apiKey: '' }).chat(request)
    expect('authorization' in fetch.mock.calls[0][1].headers).toBe(false)
  })

  it('maps text and tool calls (arguments parsed), usage and stop reason', async () => {
    const fetch = fakeFetch({
      choices: [{ message: { content: '잠시만', tool_calls: [{ id: 'c1', function: { name: 'list_tasks', arguments: '{"view":"today"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 7, completion_tokens: 3 }
    })
    const r = await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'u', model: 'm', apiKey: '' }).chat(request)

    expect(r.content).toEqual([{ type: 'text', text: '잠시만' }, { type: 'tool_use', id: 'c1', name: 'list_tasks', input: { view: 'today' } }])
    expect(r.stopReason).toBe('tool_use')
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })

  it('keeps broken tool-call JSON as an invalid marker instead of throwing', async () => {
    const fetch = fakeFetch({ choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{oops' } }] } }] })
    const r = await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'u', model: 'm', apiKey: '' }).chat(request)
    expect(r.content[0]).toMatchObject({ type: 'tool_use', input: { __invalidJson: true } })
  })

  it('writes assistant tool calls and tool results back in the OpenAI shape', async () => {
    const fetch = fakeFetch({ choices: [{ message: { content: 'done' } }] })
    await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'u', model: 'm', apiKey: '' }).chat({
      ...request,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'x', input: { a: 1 } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'R' }] }
      ]
    })
    const messages = JSON.parse(fetch.mock.calls[0][1].body).messages
    expect(messages[2]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }] })
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'R' })
  })

  it.each([[401, 'auth'], [429, 'rate_limit'], [503, 'overloaded'], [400, 'bad_request']])('HTTP %i becomes %s', async (status, kind) => {
    const error = await createOpenAiCompatibleAdapter({ fetch: fakeFetch({}, status), baseUrl: 'u', model: 'm', apiKey: 'K' }).chat(request).catch((e: unknown) => e)
    expect((error as LlmError).kind).toBe(kind)
  })

  it('a thrown fetch becomes a network error that does not carry the key or address', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new Error('connect ECONNREFUSED https://secret.host key=K')
    })
    const error = (await createOpenAiCompatibleAdapter({ fetch, baseUrl: 'https://secret.host', model: 'm', apiKey: 'K' }).chat(request).catch((e: unknown) => e)) as LlmError
    expect(error.kind).toBe('network')
    expect(error.message).not.toMatch(/secret|K=|key/)
  })
})

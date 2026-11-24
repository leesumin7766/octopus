import { describe, expect, it, vi } from 'vitest'
import { createAdapterResolver, type KeyStore } from '../../src/main/core/command/adapterResolver'
import type { AnthropicClientLike } from '../../src/main/core/command/llm/anthropicAdapter'
import { LlmError } from '../../src/main/core/command/llm/types'
import { createKeyStore } from '../../src/main/platform/llmClients'
import { createSecureStore, type SecretCipher } from '../../src/main/platform/secureStore'
import { DEFAULT_MODELS, type LlmProvider, type ModelEntry } from '../../src/shared/command/types'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const models: ModelEntry[] = [
  ...DEFAULT_MODELS,
  { id: 'local', provider: 'openai-compatible', model: 'qwen', label: 'Local', baseUrl: 'http://localhost:1234/v1' }
]

function memoryKeys(initial: Partial<Record<LlmProvider, string>> = {}): KeyStore {
  const data = { ...initial }
  return { get: (p) => data[p], set: (p, k) => void (data[p] = k), delete: (p) => void delete data[p] }
}

const base = (keys: KeyStore) => ({
  keys,
  models: () => models,
  createAnthropicClient: vi.fn((): AnthropicClientLike => ({ messages: { create: vi.fn(), stream: vi.fn() }, beta: { messages: { create: vi.fn(), stream: vi.fn() } } })),
  fetch: vi.fn()
})

describe('adapter resolver', () => {
  it('without a key, anthropic models say no_key (and the client is never built)', () => {
    const deps = base(memoryKeys())
    const resolve = createAdapterResolver(deps)
    expect(() => resolve('anthropic-opus')).toThrowError(expect.objectContaining({ kind: 'no_key' }))
    expect(deps.createAnthropicClient).not.toHaveBeenCalled()
  })

  it('with a key, builds the client from that key', () => {
    const deps = base(memoryKeys({ anthropic: 'sk-test' }))
    createAdapterResolver(deps)('anthropic-sonnet')
    expect(deps.createAnthropicClient).toHaveBeenCalledWith('sk-test')
  })

  it('a key set or cleared later takes effect on the next call', () => {
    const keys = memoryKeys()
    const resolve = createAdapterResolver(base(keys))
    keys.set('anthropic', 'k')
    expect(() => resolve('anthropic-opus')).not.toThrow()
    keys.delete('anthropic')
    expect(() => resolve('anthropic-opus')).toThrow(LlmError)
  })

  it('an openai-compatible local model works without a key', () => {
    expect(() => createAdapterResolver(base(memoryKeys()))('local')).not.toThrow()
  })

  it('an unknown model id is a bad_request; an unreadable key store counts as no key', () => {
    const resolve = createAdapterResolver(base(memoryKeys()))
    expect(() => resolve('nope')).toThrowError(expect.objectContaining({ kind: 'bad_request' }))

    const broken: KeyStore = { get: () => { throw new Error('cannot decrypt') }, set: () => undefined, delete: () => undefined }
    expect(() => createAdapterResolver(base(broken))('anthropic-opus')).toThrowError(expect.objectContaining({ kind: 'no_key' }))
  })
})

describe('key store on the secure store', () => {
  const cipher: SecretCipher = {
    isAvailable: () => true,
    encrypt: (s) => Buffer.from(Buffer.from(s).toString('base64')), // 가짜 암호화: 평문이 그대로 보이지 않기만 하면 된다
    decrypt: (b) => Buffer.from(b.toString(), 'base64').toString()
  }

  it('keeps each provider under llm:<provider>, and the file never contains the plain key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'octopus-keys-'))
    try {
      const file = join(dir, 'secrets.bin')
      const store = createSecureStore(file, cipher)
      const keys = createKeyStore(store)
      keys.set('anthropic', 'sk-ant-SECRET')
      keys.set('openai-compatible', 'sk-oai-SECRET')

      expect(store.get('llm:anthropic', 'apiKey')).toBe('sk-ant-SECRET')
      expect(keys.get('openai-compatible')).toBe('sk-oai-SECRET')
      expect(readFileSync(file).toString()).not.toContain('SECRET')

      keys.delete('anthropic')
      expect(keys.get('anthropic')).toBeUndefined()
      expect(keys.get('openai-compatible')).toBe('sk-oai-SECRET')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

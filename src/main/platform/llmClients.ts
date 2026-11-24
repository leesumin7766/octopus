import Anthropic from '@anthropic-ai/sdk'
import type { LlmProvider } from '../../shared/command/types'
import type { KeyStore } from '../core/command/adapterResolver'
import type { AnthropicClientLike } from '../core/command/llm/anthropicAdapter'
import type { FetchLike } from '../core/command/llm/openaiCompatibleAdapter'
import type { SecureStore } from './secureStore'

const REQUEST_TIMEOUT_MS = 120_000

/** 실제 SDK 클라이언트. 키는 호출 때마다 받아 만든다(저장하지 않음). */
export function createAnthropicClient(apiKey: string): AnthropicClientLike {
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })
}

/** 시간 제한이 붙은 fetch. */
export const timedFetch: FetchLike = (url, init) =>
  fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

/** 보안 저장소의 이름공간 llm:<provider> 아래 'apiKey' 로 보관한다. */
export function createKeyStore(store: SecureStore): KeyStore {
  const ns = (provider: LlmProvider): string => `llm:${provider}`
  return {
    get: (provider) => store.get(ns(provider), 'apiKey'),
    set: (provider, key) => store.set(ns(provider), 'apiKey', key),
    delete: (provider) => store.delete(ns(provider), 'apiKey')
  }
}

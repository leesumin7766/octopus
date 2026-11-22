import type { LlmProvider, ModelEntry } from '../../../shared/command/types'
import { createAnthropicAdapter, type AnthropicClientLike } from './llm/anthropicAdapter'
import { createOpenAiCompatibleAdapter, type FetchLike } from './llm/openaiCompatibleAdapter'
import { LlmError, type LlmAdapter } from './llm/types'

/** 제공자별 API 키 보관. 실제 앱은 보안 저장소(이름공간 llm:<provider>), 테스트는 가짜. 키 원문은 이 밖으로 나가지 않는다. */
export interface KeyStore {
  get(provider: LlmProvider): string | undefined
  set(provider: LlmProvider, key: string): void
  delete(provider: LlmProvider): void
}

export interface ResolverDeps {
  keys: KeyStore
  models: () => ModelEntry[]
  createAnthropicClient: (apiKey: string) => AnthropicClientLike
  fetch: FetchLike
}

/** 모델 id → 어댑터. 키가 없으면 LlmError('no_key'). 어댑터는 호출 때마다 새로 만들어 키를 바꾸거나 지워도 바로 반영된다. */
export function createAdapterResolver(deps: ResolverDeps): (modelId: string) => LlmAdapter {
  return (modelId) => {
    const entry = deps.models().find((m) => m.id === modelId)
    if (!entry) throw new LlmError('bad_request', 'unknown model')

    let key: string | undefined
    try {
      key = deps.keys.get(entry.provider)
    } catch {
      throw new LlmError('no_key', 'secure storage unavailable') // 보안 저장소를 못 읽으면 키가 없는 것과 같게 안내한다.
    }

    if (entry.provider === 'anthropic') {
      if (!key) throw new LlmError('no_key', 'no key')
      return createAnthropicAdapter({ client: deps.createAnthropicClient(key), model: entry.model, effort: entry.effort })
    }
    // openai 호환: 로컬 서버는 키가 없어도 된다.
    return createOpenAiCompatibleAdapter({ fetch: deps.fetch, baseUrl: entry.baseUrl ?? '', model: entry.model, apiKey: key ?? '' })
  }
}

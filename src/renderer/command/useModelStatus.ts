import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmProvider, ModelEntry } from '../../shared/command/types'
import { useModelsChanged } from '../dataEvents'
import { safeInvoke } from '../safeInvoke'

export interface ModelStatus {
  loaded: boolean
  models: ModelEntry[]
  hasKey: Record<LlmProvider, boolean>
  /** 지시하기를 쓸 수 있는지: Anthropic 키가 있거나, OpenAI 호환 서버가 설정돼 있을 때 */
  connected: boolean
  reload: () => void
}

const NONE: Record<LlmProvider, boolean> = { anthropic: false, 'openai-compatible': false }

/** 지시하기에 모델이 연결돼 있는지. 키 값은 알 수 없고, 있는지만 안다. */
export function useModelStatus(): ModelStatus {
  const [state, setState] = useState<{ loaded: boolean; models: ModelEntry[]; hasKey: Record<LlmProvider, boolean> }>({
    loaded: false,
    models: [],
    hasKey: NONE
  })
  const mounted = useRef(true)

  const reload = useCallback(() => {
    void safeInvoke(() => window.octopus.command.models()).then((result) => {
      if (!mounted.current) return
      setState(result.ok ? { loaded: true, models: result.data.models, hasKey: result.data.hasKey } : { loaded: true, models: [], hasKey: NONE })
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    reload()
    return () => {
      mounted.current = false
    }
  }, [reload])
  useModelsChanged(reload)

  const connected = state.hasKey.anthropic || state.models.some((m) => m.provider === 'openai-compatible')
  return { ...state, connected, reload }
}

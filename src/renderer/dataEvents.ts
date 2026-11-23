import { useEffect } from 'react'

// 화면 사이 가벼운 알림. 지시하기가 데이터를 바꾸면 다른 화면이 새로 읽도록, 키·모델 설정이 바뀌면 지시하기 상태를 다시 보도록.

const DATA_CHANGED = 'octopus:data-changed'
const MODELS_CHANGED = 'octopus:models-changed'

export const notifyDataChanged = (): void => void window.dispatchEvent(new Event(DATA_CHANGED))
export const notifyModelsChanged = (): void => void window.dispatchEvent(new Event(MODELS_CHANGED))

function useWindowEvent(name: string, handler: () => void): void {
  useEffect(() => {
    window.addEventListener(name, handler)
    return () => window.removeEventListener(name, handler)
  }, [name, handler])
}

export const useDataChanged = (handler: () => void): void => useWindowEvent(DATA_CHANGED, handler)
export const useModelsChanged = (handler: () => void): void => useWindowEvent(MODELS_CHANGED, handler)

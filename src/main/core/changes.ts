/** 코어 데이터가 바뀌었다는 알림 통로. 받는 쪽(Arm 등)은 코어를 import 하지 않고 이 구독 함수만 받는다. */
export interface ChangeBus {
  emit(): void
  /** 구독. 돌려주는 함수로 구독을 끝낸다. */
  subscribe(listener: () => void): () => void
}

export function createChangeBus(): ChangeBus {
  const listeners = new Set<() => void>()
  return {
    emit() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // 구독자의 문제가 코어 동작을 막지 않는다.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult } from '../../shared/ipc'
import type { UpdateState } from '../../shared/update/types'
import { safeInvoke } from '../safeInvoke'

export interface UpdateControls {
  /** 처음 읽기 전에는 null */
  state: UpdateState | null
  check(): void
  download(): void
  install(): void
}

/** 업데이트 상태를 읽고, main 이 밀어 주는 변화를 따라간다. 호출 실패는 조용히 넘긴다(상태는 그대로). */
export function useUpdate(): UpdateControls {
  const [state, setState] = useState<UpdateState | null>(null)
  const pushed = useRef(false)

  useEffect(() => {
    let cancelled = false
    const stop = window.octopus.update.onState((next) => {
      pushed.current = true
      setState(next)
    })
    void safeInvoke(() => window.octopus.update.state()).then((result) => {
      // 처음 읽기보다 이벤트가 먼저 왔으면 그쪽이 더 새 값이다
      if (!cancelled && result.ok && !pushed.current) setState(result.data)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const apply = useCallback((call: () => Promise<IpcResult<UpdateState>>) => {
    void safeInvoke(call).then((result) => {
      if (result.ok) setState(result.data)
    })
  }, [])

  return {
    state,
    check: useCallback(() => apply(() => window.octopus.update.check()), [apply]),
    download: useCallback(() => apply(() => window.octopus.update.download()), [apply]),
    install: useCallback(() => void safeInvoke(() => window.octopus.update.install()), [])
  }
}

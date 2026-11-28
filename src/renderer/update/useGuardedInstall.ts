import { useState } from 'react'
import { useLeaveGuardStore } from '../leaveGuard'

/**
 * [다시 시작해서 설치]를 누를 때 쓰던 내용(떠나기 보호에 등록된 것)이 있으면 먼저 묻는다.
 * 없으면 바로 설치한다. [계속 쓰기](keep)는 설치하지 않고, [버리기](discard)는 설치한다.
 */
export function useGuardedInstall(install: () => void): { asking: boolean; requestInstall: () => void; keep: () => void; discard: () => void } {
  const guard = useLeaveGuardStore()
  const [asking, setAsking] = useState(false)
  return {
    asking,
    requestInstall: () => {
      if (guard?.isDirty()) setAsking(true)
      else install()
    },
    keep: () => setAsking(false),
    discard: () => {
      setAsking(false)
      install()
    }
  }
}

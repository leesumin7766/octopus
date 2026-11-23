import type { IpcResult } from '../shared/ipc'

/**
 * main 호출이 예외로 실패해도(main 이 아직 그 채널을 모르는 오래된 실행, 창이 닫히는 중 등) 처리되지 않은 거부로 새지 않게,
 * 오류 결과({ ok:false, code:'internal' })로 바꿔 돌려준다. 주기적으로 다시 읽는 곳에서 쓴다.
 */
export async function safeInvoke<T>(call: () => Promise<IpcResult<T>>): Promise<IpcResult<T>> {
  try {
    return await call()
  } catch {
    return { ok: false, error: { code: 'internal' } }
  }
}

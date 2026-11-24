import { isAppNavigation, type GuardOptions } from '../windowGuard'
import type { IpcMainLike } from './result'

// Electron 보안 권장: IPC 요청을 보낸 프레임이 우리 앱 화면인지 확인한다.
// 우리 앱 = 개발 서버 주소(개발 중) 또는 앱의 renderer/index.html. 그 밖(다른 주소가 불러진 프레임, 하위 프레임 등)의 요청은 거부한다.

/** IPC 이벤트 중 보는 부분 */
export interface SenderEventLike {
  senderFrame?: { url: string; parent?: unknown } | null
}

export const FORBIDDEN_RESULT = { ok: false as const, error: { code: 'forbidden' as const } }

/** 보낸 프레임이 앱의 최상위 화면인지 */
export function isTrustedSender(event: unknown, options: GuardOptions): boolean {
  const frame = (event as SenderEventLike | null | undefined)?.senderFrame
  if (!frame || typeof frame.url !== 'string') return false // 프레임을 알 수 없으면(이미 닫힘 등) 믿지 않는다
  if (frame.parent !== undefined && frame.parent !== null) return false // 하위 프레임은 앱 화면이 아니다
  return isAppNavigation(frame.url, options)
}

/**
 * handle 등록을 감싸서 모든 채널에 같은 검사를 건다. 검사를 통과하지 못하면 핸들러를 부르지 않고
 * 결과 객체 { ok:false, error:{ code:'forbidden' } } 를 돌려준다(기존 응답 방식과 같다).
 * 결과 객체가 아닌 값을 돌려주는 채널(throwChannels, 예: app:version 은 문자열)은 대신 Error('forbidden') 을 던진다.
 */
export function guardIpc(
  ipc: IpcMainLike,
  options: GuardOptions,
  onDenied?: (channel: string, url: string | null) => void,
  throwChannels: ReadonlySet<string> = new Set()
): IpcMainLike {
  return {
    handle(channel, listener) {
      ipc.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event, options)) {
          onDenied?.(channel, (event as SenderEventLike | null)?.senderFrame?.url ?? null)
          if (throwChannels.has(channel)) throw new Error('forbidden')
          return FORBIDDEN_RESULT
        }
        return listener(event, ...args)
      })
    }
  }
}

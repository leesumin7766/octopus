import { redactString, redactValue } from '../../../shared/redact'
import type { SecureStore } from '../../platform/secureStore'
import { createHttp, type HttpDeps } from './http'
import type { ArmContext, ArmCoreServices, ArmLog, ArmSecrets } from './types'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 로그 한 줄. message·data 는 이미 비밀이 가려진 값이다. */
export interface LogEntry {
  level: LogLevel
  armId: string
  message: string
  data?: unknown
}

export interface ContextDeps {
  armId: string
  interactive: boolean
  secureStore: SecureStore
  http: HttpDeps
  /** 비밀이 가려진 로그를 받는 곳(예: main 콘솔) */
  logSink: (entry: LogEntry) => void
  core: ArmCoreServices
}

/** Arm 별 비밀 저장소 도구. ArmContext 가 아니라 Arm 을 만들 때 필요한 곳(고급 설정 등)에서도 같은 이름공간을 쓴다. */
export function createArmSecrets(store: SecureStore, armId: string, onSeen?: (value: string) => void): ArmSecrets {
  const namespace = `arm:${armId}`
  return {
    get(name) {
      const value = store.get(namespace, name)
      if (value) onSeen?.(value)
      return value
    },
    set(name, value) {
      onSeen?.(value)
      store.set(namespace, name, value)
    },
    delete: (name) => store.delete(namespace, name)
  }
}

/** Arm 별 비밀 이름공간 */
export const armNamespace = (armId: string): string => `arm:${armId}`

/**
 * Arm 한 개에 줄 ArmContext 를 만든다.
 * - secrets: 이 Arm 의 이름공간('arm:<id>')만 보인다.
 * - log: 이 Arm 이 저장하거나 읽은 비밀값 원문, Authorization·token·key 류 필드, 토큰 모양의 글자를 자동으로 가린다.
 * - core: 후보 추가의 출처는 항상 이 Arm 이다.
 */
export function createArmContext(deps: ContextDeps): ArmContext {
  const seen = new Set<string>()
  const secrets = createArmSecrets(deps.secureStore, deps.armId, (value) => void seen.add(value))

  const emit = (level: LogLevel) => (message: string, data?: unknown) => {
    const known = [...seen]
    deps.logSink({
      level,
      armId: deps.armId,
      message: redactString(String(message), known),
      ...(data === undefined ? {} : { data: redactValue(data, known) })
    })
  }
  const log: ArmLog = { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }

  return {
    armId: deps.armId,
    interactive: deps.interactive,
    secrets,
    http: createHttp(deps.http),
    log,
    core: deps.core
  }
}

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

/** Arm 별 비밀 이름공간 */
export const armNamespace = (armId: string): string => `arm:${armId}`

/**
 * Arm 한 개에 줄 ArmContext 를 만든다.
 * - secrets: 이 Arm 의 이름공간('arm:<id>')만 보인다.
 * - log: 이 Arm 이 저장하거나 읽은 비밀값 원문, Authorization·token·key 류 필드, 토큰 모양의 글자를 자동으로 가린다.
 * - core: 후보 추가의 출처는 항상 이 Arm 이다.
 */
export function createArmContext(deps: ContextDeps): ArmContext {
  const namespace = armNamespace(deps.armId)
  const seen = new Set<string>()

  const secrets: ArmSecrets = {
    get(name) {
      const value = deps.secureStore.get(namespace, name)
      if (value) seen.add(value)
      return value
    },
    set(name, value) {
      seen.add(value)
      deps.secureStore.set(namespace, name, value)
    },
    delete: (name) => deps.secureStore.delete(namespace, name)
  }

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

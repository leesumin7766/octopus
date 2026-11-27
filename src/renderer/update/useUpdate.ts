import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { IpcResult } from '../../shared/ipc'
import type { UpdateState } from '../../shared/update/types'
import { safeInvoke } from '../safeInvoke'

export type UpdateAction = 'check' | 'download' | 'install'

export interface UpdateControls {
  /** 처음 읽기 전에는 null */
  state: UpdateState | null
  /** 마지막으로 실패한 동작. 다음 동작을 시작하거나 업데이트 상태가 바뀌면 지운다. */
  actionError: UpdateAction | null
  /** 답을 기다리는 동작. 같은 동작은 하나만 보낸다. */
  pending: readonly UpdateAction[]
  check(): void
  download(): void
  install(): void
}

interface Store {
  state: UpdateState | null
  actionError: UpdateAction | null
  /** 동작별로 아직 답을 기다리는 요청 번호 */
  pending: Partial<Record<UpdateAction, number>>
  /** 구독자가 모두 떠나면 올라간다. 예전 세대의 응답은 전부 버린다. */
  generation: number
  /** 상태가 바뀔 때마다 올라간다. 요청을 보낸 뒤 상태가 바뀌었으면 그 요청의 상태 응답은 버린다. */
  version: number
}

const emptyStore = (generation: number): Store => ({ state: null, actionError: null, pending: {}, generation, version: 0 })

// 알림 종과 설정 화면이 같은 상태·실패·진행 중 표시를 본다. 구독자가 모두 떠나면 비운다.
let store: Store = emptyStore(0)
const listeners = new Set<() => void>()
let requestSeq = 0
/** 가장 최근에 보낸 동작 요청 번호. 오류 표시는 이 요청의 응답만 바꿀 수 있다. */
let latestRequest = 0

function setStore(next: Store): void {
  store = next
  for (const listener of [...listeners]) listener()
}

function subscribeStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) store = emptyStore(store.generation + 1)
  }
}

function getStore(): Store {
  return store
}

/** main 이 밀어 준 상태. 밀어 준 상태는 늘 이긴다. */
function pushState(state: UpdateState): void {
  setStore({ ...store, state, actionError: null, version: store.version + 1 })
}

/** 처음 읽기·동작 응답. 그 사이에 상태가 바뀌었거나 세대가 바뀌었으면 버린다. */
function applyStateResponse(result: IpcResult<UpdateState | null>, generation: number, version: number): void {
  if (store.generation !== generation || store.version !== version) return
  if (result.ok && result.data) setStore({ ...store, state: result.data, version: store.version + 1 })
}

function startAction(action: UpdateAction, call: () => Promise<IpcResult<UpdateState | null>>): void {
  if (store.pending[action] !== undefined) return
  const id = ++requestSeq
  latestRequest = id
  const { generation, version } = store
  setStore({ ...store, actionError: null, pending: { ...store.pending, [action]: id } })
  void safeInvoke(call).then((result) => {
    if (store.generation !== generation) return
    const pending = { ...store.pending }
    if (pending[action] === id) delete pending[action]
    let next: Store = { ...store, pending }
    if (id === latestRequest) next = { ...next, actionError: result.ok ? null : action }
    setStore(next)
    applyStateResponse(result, generation, version)
  })
}

/**
 * 업데이트 상태를 읽고, main 이 밀어 주는 변화를 따라간다.
 * check·download·install 이 실패하면(ok:false 또는 예외) actionError 로 알린다. 실패해도 상태는 그대로 둔다.
 */
export function useUpdate(): UpdateControls {
  const snapshot = useSyncExternalStore(subscribeStore, getStore)

  useEffect(() => {
    const stop = window.octopus.update.onState(pushState)
    const { generation, version } = getStore()
    void safeInvoke(() => window.octopus.update.state()).then((result) => applyStateResponse(result, generation, version))
    return stop
  }, [])

  return {
    state: snapshot.state,
    actionError: snapshot.actionError,
    pending: (['check', 'download', 'install'] as const).filter((action) => snapshot.pending[action] !== undefined),
    check: useCallback(() => startAction('check', () => window.octopus.update.check()), []),
    download: useCallback(() => startAction('download', () => window.octopus.update.download()), []),
    install: useCallback(() => startAction('install', () => window.octopus.update.install()), [])
  }
}

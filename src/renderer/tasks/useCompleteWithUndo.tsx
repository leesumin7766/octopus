import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IpcError, IpcResult } from '../../shared/ipc'
import type { Task } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'
import { safeInvoke } from '../safeInvoke'
import { ActionNotice } from '../ui/ActionNotice'

const t = ko.tasks

interface UndoState {
  /** 새 알림마다 바뀐다(알림이 6초를 다시 세도록 key 로 쓴다). */
  key: number
  message: string
  restore: () => Promise<IpcResult<Task>>
  /** 되돌리면 줄 긋기를 바로 거둘 할 일(체크 알림일 때) */
  taskId: string | null
  /** 만든 시각(ms) */
  at: number
}

interface Options {
  /** 상태를 바꾸는 데 성공한 뒤(체크·해제·되돌리기) 목록을 다시 읽는다. 끝나면 줄 긋기 표시를 거둔다(autoClear). */
  onSaved: () => void | Promise<void>
  /** 저장에 실패했다. 줄 긋기는 이미 풀렸다. task 가 null 이면 되돌리기 실패. */
  onFailed: (error: IpcError, task: Task | null) => void
  /** 체크에 성공한 뒤 목록을 다시 읽기 전에 기다리는 시간(ms). 흐려졌다가 사라지는 화면이 쓴다. */
  settleMs?: number
  /** false 면 표시를 스스로 거두지 않는다. 쓰는 쪽이 목록을 다시 읽은 뒤 reconcile 로 거둔다. */
  autoClear?: boolean
  /** 되돌리기 알림이 새로 뜰 때(다른 안내를 지우는 데 쓴다). */
  onNotice?: () => void
}

/**
 * 체크 → 바로 줄 긋기(저장은 done) → 되돌리기 알림 → [되돌리기] 는 open 으로.
 * 같은 할 일의 요청, 그리고 되돌리기 요청은 처리 중에 한 번만 나간다. 저장에 실패하면 줄 긋기를 풀고 onFailed 로 알린다.
 * 알림은 한 번에 하나만 뜬다(새 알림이 이전 알림을 밀어낸다). 되돌리기 알림은 '안 하기' 같은 다른 동작도 showUndo 로 쓴다.
 */
export function useCompleteWithUndo(options: Options) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  /** 바로 줄 긋기: 할 일 id → 체크됨(true)/해제됨(false). */
  const [marks, setMarks] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [undo, setUndo] = useState<UndoState | null>(null)
  const inFlight = useRef(new Set<string>())
  const latest = useRef(new Map<string, number>())
  const seq = useRef(0)
  const undoing = useRef(false)
  const mounted = useRef(true)
  const timers = useRef(new Set<number>())

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      pending.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  const clearMark = useCallback((id: string, token: number): void => {
    if (latest.current.get(id) !== token) return // 더 나중의 요청이 있으면 그쪽이 정한다
    latest.current.delete(id)
    setMarks((previous) => {
      if (!previous.has(id)) return previous
      const next = new Map(previous)
      next.delete(id)
      return next
    })
  }, [])

  const showUndo = useCallback((message: string, restore: () => Promise<IpcResult<Task>>, taskId: string | null = null): void => {
    setUndo({ key: ++seq.current, message, restore, taskId, at: Date.now() })
    optionsRef.current.onNotice?.()
  }, [])

  const dismiss = useCallback((): void => setUndo(null), [])

  /** 체크(checked=true)나 해제. 해제는 되돌리기 알림을 띄우지 않는다(그 자체가 되돌리기다). */
  const setChecked = useCallback(
    async (task: Task, checked: boolean): Promise<void> => {
      if (inFlight.current.has(task.id)) return
      inFlight.current.add(task.id)
      const token = ++seq.current
      latest.current.set(task.id, token)
      setMarks((previous) => new Map(previous).set(task.id, checked))
      const result = await safeInvoke(() => window.octopus.tasks.setStatus(task.id, checked ? 'done' : 'open'))
      inFlight.current.delete(task.id)
      if (!mounted.current) return
      if (!result.ok) {
        clearMark(task.id, token)
        optionsRef.current.onFailed(result.error, task)
        return
      }
      if (checked) showUndo(t.undo.done(task.title), () => window.octopus.tasks.setStatus(task.id, 'open'), task.id)
      const wait = checked ? (optionsRef.current.settleMs ?? 0) : 0
      if (wait > 0) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(() => {
            timers.current.delete(timer)
            resolve()
          }, wait)
          timers.current.add(timer)
        })
        if (!mounted.current) return
      }
      await optionsRef.current.onSaved()
      if (mounted.current && optionsRef.current.autoClear !== false) clearMark(task.id, token)
    },
    [clearMark, showUndo]
  )

  /** [되돌리기]. 연타해도 요청은 한 번. */
  const runUndo = useCallback(async (): Promise<void> => {
    if (!undo || undoing.current) return
    undoing.current = true
    const { restore, taskId } = undo
    setUndo(null)
    // 되돌리는 할 일은 더 줄 긋지 않는다(남은 표시가 목록을 다시 읽은 결과를 가리지 않게).
    if (taskId !== null) {
      latest.current.delete(taskId)
      setMarks((previous) => {
        if (!previous.has(taskId)) return previous
        const next = new Map(previous)
        next.delete(taskId)
        return next
      })
    }
    const result = await safeInvoke(restore)
    undoing.current = false
    if (!mounted.current) return
    if (!result.ok) return optionsRef.current.onFailed(result.error, null)
    await optionsRef.current.onSaved()
  }, [undo])

  /** autoClear=false 인 화면이 목록을 다시 읽은 뒤: 목록이 이미 같은 상태를 보이는 표시를 거둔다(오류로 못 읽었으면 모두). */
  const reconcile = useCallback((tasks: readonly Pick<Task, 'id' | 'status'>[] | null): void => {
    setMarks((previous) => {
      if (previous.size === 0) return previous
      const next = new Map(previous)
      for (const [id, checked] of previous) {
        if (inFlight.current.has(id)) continue
        const task = tasks?.find((candidate) => candidate.id === id)
        if (tasks === null || task === undefined || (task.status === 'done') === checked) {
          next.delete(id)
          latest.current.delete(id)
        }
      }
      return next.size === previous.size ? previous : next
    })
  }, [])

  /** 되돌리기 알림. 모양과 6초 규칙은 모든 화면이 같다. */
  const undoNotice = (className = ''): ReactNode =>
    undo ? (
      <ActionNotice
        key={undo.key}
        message={undo.message}
        actionLabel={t.undo.button}
        startedAt={undo.at}
        onAction={() => void runUndo()}
        // 옛 알림의 만료가 새 알림을 지우지 않게, 자기 알림일 때만 지운다.
        onExpire={() => setUndo((current) => (current?.key === undo.key ? null : current))}
        className={className}
      />
    ) : null

  return { marks, setChecked, showUndo, runUndo, dismiss, reconcile, undoNotice, hasUndo: undo !== null }
}

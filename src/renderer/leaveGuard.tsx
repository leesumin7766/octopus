import { createContext, useContext, useEffect, useId, useRef } from 'react'
import { ko } from './i18n/ko'

// 화면을 옮기기 전에 쓰던 내용이 있는지 확인하는 장치.
// 저장하지 않은 내용이 있는 자리(입력칸·편집 패널 등)가 useLeaveGuard(dirty) 로 스스로 등록한다.
// 앱(App)은 화면을 옮기기 전에 store.isDirty() 를 보고, 쓰던 내용이 있으면 확인 띠를 먼저 띄운다.

export interface LeaveGuardStore {
  set: (id: string, dirty: boolean) => void
  remove: (id: string) => void
  isDirty: () => boolean
}

export function createLeaveGuardStore(): LeaveGuardStore {
  const dirty = new Set<string>()
  return {
    set: (id, on) => {
      if (on) dirty.add(id)
      else dirty.delete(id)
    },
    remove: (id) => {
      dirty.delete(id)
    },
    isDirty: () => dirty.size > 0
  }
}

const LeaveGuardContext = createContext<LeaveGuardStore | null>(null)

export const LeaveGuardProvider = LeaveGuardContext.Provider

/** 떠나기 보호 장치 자체(업데이트 설치처럼 화면 밖 동작이 쓰던 내용을 확인할 때). 공급자가 없으면 null. */
export function useLeaveGuardStore(): LeaveGuardStore | null {
  return useContext(LeaveGuardContext)
}

/** 이 자리에 저장하지 않은 내용이 있으면 dirty 를 true 로 둔다. 자리가 사라지면 등록도 저절로 빠진다. 공급자가 없으면 아무 일도 하지 않는다. */
export function useLeaveGuard(dirty: boolean): void {
  const store = useContext(LeaveGuardContext)
  const id = useId()
  useEffect(() => {
    store?.set(id, dirty)
  }, [store, id, dirty])
  useEffect(() => () => store?.remove(id), [store, id])
}

interface UnsavedStripProps {
  title: string
  /** [계속 쓰기]: 아무것도 바꾸지 않는다. */
  onKeep: () => void
  /** [버리기]: 쓰던 내용을 버리고 나간다. */
  onDiscard: () => void
}

/** 떠나기 전 확인 띠. 대화상자(DayDialog)와 같은 글과 모양을 쓴다. 뜨면 [계속 쓰기]에 포커스를 둔다. */
export function UnsavedStrip({ title, onKeep, onDiscard }: UnsavedStripProps) {
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    keepRef.current?.focus()
  }, [])
  const m = ko.home.localCalendar
  return (
    <div role="group" aria-label={title} className="mb-4 rounded-lg border border-[#e7c9bf] bg-[#fbeee9] p-3">
      <p className="mb-2 text-sm text-[#7d2a21]">{title}</p>
      <div className="flex flex-wrap gap-2">
        <button ref={keepRef} type="button" onClick={onKeep} className="min-h-8 rounded-lg border border-line bg-white px-3 text-sm hover:bg-black/5">
          {m.discardNo}
        </button>
        <button type="button" onClick={onDiscard} className="min-h-8 rounded-lg bg-[#7d2a21] px-3 text-sm font-semibold text-white">
          {m.discardYes}
        </button>
      </div>
    </div>
  )
}

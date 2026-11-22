import type { IpcResult } from '../ipc'
import type { Routine, RoutineHistory, RoutineInput, RoutineListData, RoutinePatch } from './types'

/** preload 가 window.octopus.routines 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다. */
export interface RoutinesApi {
  /** 호출하면 오늘의 루틴 항목이 보장된다(없을 때만 만들어짐). */
  list(): Promise<IpcResult<RoutineListData>>
  create(input: RoutineInput): Promise<IpcResult<Routine>>
  update(id: string, patch: RoutinePatch): Promise<IpcResult<Routine>>
  remove(id: string): Promise<IpcResult<null>>
  /** 최근 days 일(기본 14)의 루틴별 날짜 → 완료 여부 */
  history(days?: number): Promise<IpcResult<RoutineHistory>>
}

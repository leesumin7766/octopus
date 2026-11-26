import { UPDATE_ERRORS, UPDATE_STATUSES, type UpdateState } from '../update/types'

const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length <= max ? value : undefined)

/** main 이 밀어 준 업데이트 상태를 확인한다. 모양이 맞지 않으면 null(화면에 넘기지 않는다). 모르는 칸은 버린다. */
export function parseUpdateState(value: unknown): UpdateState | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!UPDATE_STATUSES.includes(v.status as never)) return null
  const current = str(v.current, 64)
  if (current === undefined) return null
  const state: UpdateState = { status: v.status as UpdateState['status'], current }
  const version = str(v.version, 64)
  if (version !== undefined) state.version = version
  const notes = str(v.notes, 4000)
  if (notes !== undefined) state.notes = notes
  if (typeof v.percent === 'number' && Number.isFinite(v.percent)) state.percent = Math.min(100, Math.max(0, Math.round(v.percent)))
  if (UPDATE_ERRORS.includes(v.error as never)) state.error = v.error as UpdateState['error']
  if (v.auto === true) state.auto = true
  return state
}

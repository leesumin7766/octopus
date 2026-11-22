import { PIE_SLOT_COUNT } from './actions'

// 원형 메뉴의 각도·거리 계산과 누르기 동작 판정. 화면(DOM) 없이 시험할 수 있는 순수 함수다.

/** 가운데에 이만큼(px)보다 가까우면 칸을 고르지 않는다(데드존). */
export const DEAD_ZONE_PX = 36
/** 가운데에서 이보다 멀면 칸을 고르지 않는다. */
export const OUTER_RADIUS_PX = 190
/** 이 거리(px)보다 적게 움직이고 놓으면 "끌지 않았다". */
export const TAP_DISTANCE_PX = 8
/** 이 시간(ms)보다 짧게 누르고 놓으면 "짧게 눌렀다". */
export const TAP_MS = 300

const SLOT_DEGREES = 360 / PIE_SLOT_COUNT

/**
 * 가운데에서 (dx, dy) 만큼 떨어진 점이 가리키는 칸 번호(0..7).
 * 0 은 12시 방향 칸(12시가 그 칸의 가운데)이고 시계 방향으로 커진다. 데드존이나 바깥이면 null.
 */
export function slotFromPoint(dx: number, dy: number, inner = DEAD_ZONE_PX, outer = OUTER_RADIUS_PX): number | null {
  const distance = Math.hypot(dx, dy)
  if (!Number.isFinite(distance) || distance < inner || distance > outer) return null

  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI // 0 = 오른쪽, 90 = 아래
  // 첫 칸의 가운데가 12시에 오도록 반 칸(22.5도)만큼 돌려서 센다.
  const fromTop = (((degrees + 90 + SLOT_DEGREES / 2) % 360) + 360) % 360
  return Math.floor(fromTop / SLOT_DEGREES) % PIE_SLOT_COUNT
}

/** 칸 i 의 가운데 방향(도). 첫 칸(0)의 가운데가 12시(-90)이고 시계 방향으로 커진다. */
export function slotCenterAngle(index: number): number {
  return -90 + index * SLOT_DEGREES
}

/** 가운데에서 radius 만큼 떨어진, 칸 i 의 가운데 방향의 점. */
export function slotCenterPoint(index: number, radius: number): { x: number; y: number } {
  const radians = (slotCenterAngle(index) * Math.PI) / 180
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }
}

/** 칸 i 의 부채꼴 경계 두 각도(도) */
export function slotAngles(index: number): { start: number; end: number } {
  const start = slotCenterAngle(index) - SLOT_DEGREES / 2
  return { start, end: start + SLOT_DEGREES }
}

/** 칸 번호를 delta 만큼 옮긴다(맨 끝에서 반대편으로 이어진다). */
export function stepSlot(index: number, delta: number, count = PIE_SLOT_COUNT): number {
  return (((index + delta) % count) + count) % count
}

/** 누른 뒤 놓았을 때 이동 거리와 시간으로 "짧게 눌렀는지" 판정 */
export function isTap(distance: number, durationMs: number): boolean {
  return distance < TAP_DISTANCE_PX && durationMs < TAP_MS
}

export type ReleaseOutcome = 'run' | 'keep-open' | 'close'

/**
 * 원을 누르고 있다가 놓았을 때 할 일.
 * - 칸을 가리키고 있으면 실행
 * - 칸이 없고 짧게 눌렀다면: 이미 열려 있던 메뉴면 닫고, 막 연 거라면 열어 둔다
 * - 그 밖(끌었다가 빈 곳에서 놓음, 오래 누름)은 닫는다
 */
export function releaseOutcome(input: { slot: number | null; distance: number; durationMs: number; wasOpen: boolean }): ReleaseOutcome {
  if (input.slot !== null) return 'run'
  if (isTap(input.distance, input.durationMs) && !input.wasOpen) return 'keep-open'
  return 'close'
}

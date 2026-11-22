// 홈 화면 배치: 카드 4개가 2×2 자리(왼위·오른위·왼아래·오른아래)에 놓이고,
// 가로 경계(col)와 세로 경계(row)의 위치를 비율(%)로 정한다. 모두 순수 함수다.

export type CardId = 'todo' | 'calendar' | 'memo' | 'shortcuts'
export type Direction = 'up' | 'down' | 'left' | 'right'

export const CARD_IDS: readonly CardId[] = ['todo', 'calendar', 'memo', 'shortcuts']

export interface HomeLayout {
  version: 1
  /** 자리 순서: [왼위, 오른위, 왼아래, 오른아래] */
  order: CardId[]
  /** 왼쪽 카드 열의 너비 비율(%) */
  col: number
  /** 위쪽 카드 줄의 높이 비율(%) */
  row: number
}

export const MIN_RATIO = 25
export const MAX_RATIO = 75
export const DEFAULT_RATIO = 50
/** 키보드로 경계를 움직일 때의 한 번 이동량(%) */
export const RATIO_STEP = 5

export function defaultLayout(): HomeLayout {
  return { version: 1, order: [...CARD_IDS], col: DEFAULT_RATIO, row: DEFAULT_RATIO }
}

/** 비율을 25~75 로 제한하고 정수로 맞춘다. 숫자가 아니면 50. */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATIO
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(value)))
}

/** 포인터가 경계 영역 안에서 offset(px) 만큼 떨어져 있을 때의 비율. 영역 크기를 모르면 null. */
export function ratioFromPointer(offset: number, size: number): number | null {
  if (!(size > 0) || !Number.isFinite(offset)) return null
  return clampRatio((offset / size) * 100)
}

/** 키보드: 방향(-1 은 왼쪽·위, 1 은 오른쪽·아래)으로 5%씩 */
export function stepRatio(current: number, direction: -1 | 1): number {
  return clampRatio(current + direction * RATIO_STEP)
}

/** 자리 번호 0..3 에서 이 방향의 이웃 자리. 가장자리면 null. */
export function neighborPosition(position: number, direction: Direction): number | null {
  const column = position % 2
  const row = position < 2 ? 0 : 1
  switch (direction) {
    case 'left':
      return column === 1 ? position - 1 : null
    case 'right':
      return column === 0 ? position + 1 : null
    case 'up':
      return row === 1 ? position - 2 : null
    case 'down':
      return row === 0 ? position + 2 : null
  }
}

/** 이 자리에서 옮길 수 있는 방향들(가장자리 쪽은 빠진다). */
export function movableDirections(position: number): Direction[] {
  return (['up', 'down', 'left', 'right'] as const).filter((direction) => neighborPosition(position, direction) !== null)
}

export function positionOf(layout: HomeLayout, card: CardId): number {
  return layout.order.indexOf(card)
}

/** 카드를 이 방향의 이웃 카드와 자리 교환한다. 가장자리면 아무것도 하지 않고 같은 객체를 돌려준다. */
export function moveCard(layout: HomeLayout, card: CardId, direction: Direction): HomeLayout {
  const from = positionOf(layout, card)
  const to = from < 0 ? null : neighborPosition(from, direction)
  if (to === null) return layout

  const order = [...layout.order]
  ;[order[from], order[to]] = [order[to], order[from]]
  return { ...layout, order }
}

export function setCol(layout: HomeLayout, value: number): HomeLayout {
  return { ...layout, col: clampRatio(value) }
}

export function setRow(layout: HomeLayout, value: number): HomeLayout {
  return { ...layout, row: clampRatio(value) }
}

/** 두 경계를 반반으로(자리 순서는 그대로) */
export function resetRatios(layout: HomeLayout): HomeLayout {
  return { ...layout, col: DEFAULT_RATIO, row: DEFAULT_RATIO }
}

export function sameLayout(a: HomeLayout, b: HomeLayout): boolean {
  return a.col === b.col && a.row === b.row && a.order.every((card, index) => card === b.order[index])
}

/**
 * 저장된 값을 배치로 읽는다. 모양이 틀리면(버전·카드 빠짐·겹침·숫자 아님) null.
 * 비율이 범위를 벗어나면 25~75 로 맞춘다.
 */
export function parseLayout(raw: unknown): HomeLayout | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value['version'] !== 1) return null

  const order = value['order']
  if (!Array.isArray(order) || order.length !== CARD_IDS.length) return null
  if (!CARD_IDS.every((id) => order.includes(id)) || new Set(order).size !== CARD_IDS.length) return null

  const { col, row } = value
  if (typeof col !== 'number' || typeof row !== 'number' || !Number.isFinite(col) || !Number.isFinite(row)) return null

  return { version: 1, order: [...(order as CardId[])], col: clampRatio(col), row: clampRatio(row) }
}

/** 저장된 값이 깨졌으면 기본 배치로 */
export function normalizeLayout(raw: unknown): HomeLayout {
  return parseLayout(raw) ?? defaultLayout()
}

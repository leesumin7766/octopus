import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  DEFAULT_RATIO,
  defaultLayout,
  moveCard,
  setCol,
  setRow,
  type CardId,
  type Direction,
  type HomeLayout
} from '../../shared/home/layout'
import { ko } from '../i18n/ko'
import { useSetting } from '../settings/useSetting'
import { formatHomeDate, msUntilNextMidnight, todayString } from '../tasks/format'
import { CardFrame } from './CardFrame'
import { MemoCard } from './cards/MemoCard'
import { CalendarCard, ShortcutsCard } from './cards/PlaceholderCards'
import { TodoCard } from './cards/TodoCard'
import { ResizeSeparator } from './ResizeSeparator'

const t = ko.home

/** 카드 사이 경계 영역의 두께(px) */
const GAP_PX = 12

/** 자리 번호 → 격자 칸 (경계 줄·열이 사이에 하나씩 끼어 있다) */
const PLACEMENT = [
  { gridRow: 1, gridColumn: 1 },
  { gridRow: 1, gridColumn: 3 },
  { gridRow: 3, gridColumn: 1 },
  { gridRow: 3, gridColumn: 3 }
] as const

interface HomeScreenProps {
  /** 화면 배치 모드(왼쪽 메뉴의 "화면 배치" 버튼으로 켠다) */
  arranging: boolean
  onDoneArranging: () => void
  onNavigate: (screen: 'tasks' | 'memos') => void
  /** 완료 체크 뒤 목록에서 사라지기까지 흐려지는 시간 */
  fadeMs?: number
  /** 빠른 입력의 미리보기 대기 시간 */
  previewDebounceMs?: number
}

export function HomeScreen({ arranging, onDoneArranging, onNavigate, fadeMs = 350, previewDebounceMs = 250 }: HomeScreenProps) {
  const { value: layout, setLocal, persist } = useSetting('home.layout')
  const gridRef = useRef<HTMLDivElement>(null)
  const [dayTick, setDayTick] = useState(0)

  // 자정이 지나면 날짜 제목과 오늘 목록을 새로 그린다.
  useEffect(() => {
    const timer = window.setTimeout(() => setDayTick((tick) => tick + 1), msUntilNextMidnight(new Date()) + 1000)
    return () => window.clearTimeout(timer)
  }, [dayTick])

  const today = todayString()

  function change(next: HomeLayout): void {
    setLocal(next)
    persist(next)
  }

  function renderCard(card: CardId) {
    switch (card) {
      case 'todo':
        return <TodoCard dayKey={today} fadeMs={fadeMs} previewDebounceMs={previewDebounceMs} onOpenTasks={() => onNavigate('tasks')} />
      case 'calendar':
        return <CalendarCard />
      case 'memo':
        return <MemoCard onOpenMemos={() => onNavigate('memos')} />
      case 'shortcuts':
        return <ShortcutsCard />
    }
  }

  const gridStyle: CSSProperties | undefined = layout
    ? {
        gridTemplateColumns: `${layout.col}fr ${GAP_PX}px ${100 - layout.col}fr`,
        gridTemplateRows: `${layout.row}fr ${GAP_PX}px ${100 - layout.row}fr`
      }
    : undefined

  return (
    <div className="flex h-full min-w-0 flex-col gap-2.5 bg-page px-5 pb-5 pt-3.5 text-ink">
      <div className="flex min-h-8 items-center justify-center">
        <h1 className="text-base font-semibold">{formatHomeDate(new Date())}</h1>
      </div>

      {arranging && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent-strong">
          <span className="min-w-60 flex-1">{t.arranging}</span>
          <button
            type="button"
            onClick={() => change(defaultLayout())}
            className="min-h-9 rounded-lg border border-[#c9c7f0] bg-white px-3 text-ink hover:bg-white/70"
          >
            {t.resetLayout}
          </button>
          <button type="button" onClick={onDoneArranging} className="min-h-9 rounded-lg bg-accent px-3.5 font-semibold text-white hover:bg-accent-strong">
            {t.doneArranging}
          </button>
        </div>
      )}

      {!layout ? (
        <div aria-busy="true" className="flex-1" />
      ) : (
        <div ref={gridRef} style={gridStyle} className="relative grid min-h-0 flex-1">
          {layout.order.map((card, position) => (
            <CardFrame
              key={card}
              card={card}
              position={position}
              arranging={arranging}
              onMove={(id: CardId, direction: Direction) => change(moveCard(layout, id, direction))}
              style={PLACEMENT[position]}
            >
              {renderCard(card)}
            </CardFrame>
          ))}

          <ResizeSeparator
            orientation="vertical"
            value={layout.col}
            label={t.columnSeparator}
            areaRef={gridRef}
            style={{ gridColumn: 2, gridRow: '1 / 4' }}
            onChange={(value) => setLocal(setCol(layout, value))}
            onCommit={() => persist()}
            onReset={() => setLocal(setCol(layout, DEFAULT_RATIO))}
          />
          <ResizeSeparator
            orientation="horizontal"
            value={layout.row}
            label={t.rowSeparator}
            areaRef={gridRef}
            style={{ gridRow: 2, gridColumn: '1 / 4' }}
            onChange={(value) => setLocal(setRow(layout, value))}
            onCommit={() => persist()}
            onReset={() => setLocal(setRow(layout, DEFAULT_RATIO))}
          />

          {/* 두 경계가 만나는 점의 지름 68px 원 자리. 크기를 조절하면 함께 움직인다(원형 메뉴는 다음 항목). */}
          <div className="pointer-events-none relative z-10" style={{ gridRow: 2, gridColumn: 2 }}>
            <div
              aria-hidden="true"
              data-testid="center-spot"
              title={t.centerSpot}
              className="absolute left-1/2 top-1/2 size-[68px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_4px_14px_rgba(51,70,200,0.35)]"
            />
          </div>
        </div>
      )}
    </div>
  )
}

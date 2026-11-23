import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { shortcutIdOf } from '../../shared/pie/actions'
import type { Shortcut } from '../../shared/shortcuts/types'
import { ko } from '../i18n/ko'
import type { Screen } from '../nav/NavMenu'
import { describeSlots, type SlotInfo } from '../pie/actions'
import { PieMenu } from '../pie/PieMenu'
import { useSetting } from '../settings/useSetting'
import { errorMessage } from '../tasks/errors'
import { formatHomeDate, msUntilNextMidnight, todayString } from '../tasks/format'
import { CardFrame } from './CardFrame'
import { MemoCard } from './cards/MemoCard'
import { CalendarCard } from './cards/PlaceholderCards'
import { ShortcutsCard } from './cards/ShortcutsCard'
import { TodoCard } from './cards/TodoCard'
import { MemoQuickDialog, TaskQuickDialog } from './QuickDialogs'
import { ResizeSeparator } from './ResizeSeparator'

const t = ko.home

/** 카드 사이 경계 영역의 두께(px) */
const GAP_PX = 12

/** 알림이 떠 있는 시간(ms) */
const NOTICE_MS = 4000

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
  onNavigate: (screen: Screen) => void
  /** 지시하기 창 열기 */
  onOpenCommand?: () => void
  /** 모델이 연결돼 있어 원형 메뉴의 지시하기 칸을 쓸 수 있는지 */
  commandReady?: boolean
  /** 완료 체크 뒤 목록에서 사라지기까지 흐려지는 시간 */
  fadeMs?: number
  /** 빠른 입력의 미리보기 대기 시간 */
  previewDebounceMs?: number
  /** 개발용 캡처: 원형 메뉴를 펼친 채로 시작하고 한 칸을 강조한다. */
  pieDemo?: { hover: number }
}

interface Notice {
  kind: 'info' | 'error'
  text: string
}

export function HomeScreen({
  arranging,
  onDoneArranging,
  onNavigate,
  onOpenCommand,
  commandReady = false,
  fadeMs = 350,
  previewDebounceMs = 250,
  pieDemo
}: HomeScreenProps) {
  const { value: layout, setLocal, persist } = useSetting('home.layout')
  const pie = useSetting('pie.slots')
  const gridRef = useRef<HTMLDivElement>(null)
  const [dayTick, setDayTick] = useState(0)
  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null)
  const [dialog, setDialog] = useState<'task' | 'memo' | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const mounted = useRef(true)
  const noticeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.clearTimeout(noticeTimer.current)
    }
  }, [])

  // 자정이 지나면 날짜 제목과 오늘 목록을 새로 그린다.
  useEffect(() => {
    const timer = window.setTimeout(() => setDayTick((tick) => tick + 1), msUntilNextMidnight(new Date()) + 1000)
    return () => window.clearTimeout(timer)
  }, [dayTick])

  const loadShortcuts = useCallback(async (): Promise<void> => {
    const result = await window.octopus.shortcuts.list()
    if (mounted.current) setShortcuts(result.ok ? result.data : [])
  }, [])

  useEffect(() => {
    void loadShortcuts()
  }, [loadShortcuts])

  function showNotice(next: Notice): void {
    setNotice(next)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }

  async function openShortcut(id: string): Promise<void> {
    const result = await window.octopus.shortcuts.open(id)
    if (!result.ok) {
      showNotice({ kind: 'error', text: errorMessage(result.error) })
      if (result.error.code === 'not_found') void loadShortcuts()
    }
    // opened=false 는 실행 파일 확인 창에서 사용자가 취소한 것이라 알림을 띄우지 않는다.
  }

  /** 원형 메뉴에서 쓸 수 있는 칸을 골랐을 때 */
  function runSlot(slot: SlotInfo): void {
    const { action } = slot
    const shortcutId = shortcutIdOf(action)
    if (shortcutId !== null) return void openShortcut(shortcutId)

    switch (action) {
      case 'nav:home':
        return
      case 'nav:tasks':
        return onNavigate('tasks')
      case 'nav:routines':
        return onNavigate('routines')
      case 'nav:memos':
        return onNavigate('memos')
      case 'nav:settings':
        return onNavigate('settings')
      case 'task:quickAdd':
        return setDialog('task')
      case 'memo:quickAdd':
        return setDialog('memo')
      case 'command':
        return onOpenCommand?.()
      default:
        // 아직 없는 기능(지시하기·Arm·위키)은 쓸 수 없는 칸이라 여기까지 오지 않는다.
        return
    }
  }

  const slotInfos = useMemo(
    () => (pie.value && shortcuts ? describeSlots(pie.value, shortcuts, { command: commandReady }) : null),
    [pie.value, shortcuts, commandReady]
  )

  const today = todayString()

  function change(next: HomeLayout): void {
    setLocal(next)
    persist(next)
  }

  function renderCard(card: CardId) {
    switch (card) {
      case 'todo':
        return (
          <TodoCard
            dayKey={today}
            refreshKey={refreshKey}
            fadeMs={fadeMs}
            previewDebounceMs={previewDebounceMs}
            onOpenTasks={() => onNavigate('tasks')}
          />
        )
      case 'calendar':
        return <CalendarCard />
      case 'memo':
        return <MemoCard refreshKey={refreshKey} onOpenMemos={() => onNavigate('memos')} />
      case 'shortcuts':
        return <ShortcutsCard shortcuts={shortcuts} onChanged={() => void loadShortcuts()} onOpen={(id) => void openShortcut(id)} />
    }
  }

  const gridStyle: CSSProperties | undefined = layout
    ? {
        gridTemplateColumns: `${layout.col}fr ${GAP_PX}px ${100 - layout.col}fr`,
        gridTemplateRows: `${layout.row}fr ${GAP_PX}px ${100 - layout.row}fr`
      }
    : undefined

  return (
    <div className="relative flex h-full min-w-0 flex-col gap-2.5 bg-page px-5 pb-5 pt-3.5 text-ink">
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

          {/* 두 경계가 만나는 점의 원 버튼과 8칸 원형 메뉴. 크기를 조절하면 함께 움직인다. */}
          {slotInfos && (
            <PieMenu slots={slotInfos} onRun={runSlot} initialOpen={pieDemo !== undefined} initialHover={pieDemo?.hover ?? null} />
          )}
        </div>
      )}

      {dialog === 'task' && (
        <TaskQuickDialog
          previewDebounceMs={previewDebounceMs}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null)
            setRefreshKey((key) => key + 1)
            showNotice({ kind: 'info', text: t.dialogs.taskAdded })
          }}
        />
      )}
      {dialog === 'memo' && (
        <MemoQuickDialog
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setRefreshKey((key) => key + 1)
            showNotice({ kind: 'info', text: t.dialogs.memoSaved })
          }}
        />
      )}

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className="absolute bottom-6 left-1/2 z-[70] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] bg-[#1f1f1d] px-4 py-3 text-sm text-[#f6f6f3]"
        >
          {notice.text}
        </div>
      )}
    </div>
  )
}

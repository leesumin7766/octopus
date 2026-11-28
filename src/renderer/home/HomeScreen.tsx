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
import type { Task } from '../../shared/tasks/types'
import { ko } from '../i18n/ko'
import { safeInvoke } from '../safeInvoke'
import type { Screen } from '../nav/NavMenu'
import { describeSlots, type SlotInfo } from '../pie/actions'
import { PieMenu } from '../pie/PieMenu'
import { useSetting } from '../settings/useSetting'
import { errorMessage } from '../tasks/errors'
import { formatHomeDate, msUntilNextMidnight, todayString } from '../tasks/format'
import { useDataChanged } from '../dataEvents'
import { CardFrame } from './CardFrame'
import { MemoCard } from './cards/MemoCard'
import type { CalendarToday } from '../../shared/calendar/types'
import { CalendarCard } from './cards/CalendarCard'
import { DayDialog } from './calendar/DayDialog'
import { ShortcutsCard } from './cards/ShortcutsCard'
import { TodoCard } from './cards/TodoCard'
import { MemoQuickDialog, TaskQuickDialog } from './QuickDialogs'
import { ResizeSeparator } from './ResizeSeparator'
import { useNarrowWindow } from '../layout/useNarrowWindow'
import { SaveFailedNotice } from '../settings/SaveFailedNotice'

/** 좁은 창에서 오늘 할 일 카드가 보여야 하는 최소 높이(px): 할 일 다섯 개 정도 */
const NARROW_TODO_MIN_PX = 440

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
  /** 개발용 캡처: 오늘의 날짜 상세를 열어 둔 채로 시작한다. */
  dayDemo?: boolean
  /** 날짜 상세가 열리고 닫힐 때 알린다(지시하기 단축키를 막는 데 쓴다). */
  onDayDialogChange?: (open: boolean) => void
  /** 추가 안내의 [보기]: 할 일 하나를 그 보기에서 연다. */
  onOpenTask?: (task: Task) => void
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
  pieDemo,
  dayDemo = false,
  onDayDialogChange,
  onOpenTask
}: HomeScreenProps) {
  const { value: layout, setLocal, persist, saveFailed: layoutSaveFailed, saving: layoutSaving, retry: retryLayout } = useSetting('home.layout')
  const pie = useSetting('pie.slots')
  const narrow = useNarrowWindow()
  const gridRef = useRef<HTMLDivElement>(null)
  const [dayTick, setDayTick] = useState(0)
  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null)
  const [shortcutsFailed, setShortcutsFailed] = useState(false)
  const [dialog, setDialog] = useState<'task' | 'memo' | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // 다른 곳(지시하기·날짜 상세 등)에서 데이터가 바뀌면 홈을 다시 그리지 않고, 읽는 카드만 다시 읽게 한다.
  // 그래서 작성 중인 메모·바로가기 입력, 달력의 보던 달과 선택 날짜가 그대로 남는다.
  useDataChanged(() => {
    setRefreshKey((key) => key + 1)
    void loadShortcuts()
  })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [calendar, setCalendar] = useState<CalendarToday | null>(null)
  /** 날짜 상세에서 보는 날짜(YYYY-MM-DD). null 이면 상세를 닫은 상태. */
  /** 달력에서 마지막으로 고른 날짜. 상세를 닫아도 남아 칸에 표시된다. */
  const [selectedDay, setSelectedDay] = useState<string | null>(() => (dayDemo ? todayString() : null))
  /** 날짜 상세가 열려 있는지(열려 있으면 값이 날짜, 닫혀 있으면 null) */
  const [dayTarget, setDayTarget] = useState<string | null>(() => (dayDemo ? todayString() : null))
  /** 상세를 열 때마다 바뀌어 대화상자를 새로 그린다 */
  const [dayOpening, setDayOpening] = useState(0)

  useEffect(() => {
    onDayDialogChange?.(dayTarget !== null)
  }, [dayTarget, onDayDialogChange])

  /** 날짜 칸·원형 메뉴에서 날짜 상세를 연다. 고른 날짜는 선택으로 남는다. */
  function openDay(date: string): void {
    setSelectedDay(date)
    setDayTarget(date)
    setDayOpening((n) => n + 1)
  }
  const [now, setNow] = useState(() => new Date())
  const [obsidianOn, setObsidianOn] = useState(false)
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

  // 읽기에 실패하면 빈 목록으로 바꾸지 않는다. 이미 보이던 목록은 남기고, 실패를 따로 알려 다시 시도하게 한다.
  const loadShortcuts = useCallback(async (): Promise<void> => {
    const result = await safeInvoke(() => window.octopus.shortcuts.list())
    if (!mounted.current) return
    if (result.ok) setShortcuts(result.data)
    setShortcutsFailed(!result.ok)
  }, [])

  useEffect(() => {
    void loadShortcuts()
  }, [loadShortcuts])

  const loadCalendar = useCallback(async (): Promise<void> => {
    const result = await safeInvoke(() => window.octopus.calendar.today())
    if (!mounted.current) return
    setNow(new Date())
    const armList = await safeInvoke(() => window.octopus.arms.list())
    if (!mounted.current) return
    setObsidianOn(armList.ok && armList.data.some((arm) => arm.id === 'obsidian' && arm.status.state === 'on'))
    // 못 읽으면(main 이 응답하지 않음·저장소 문제 등) 오류 상태로 보여 주고(다음 주기에 다시 읽는다) 앱은 계속 쓴다.
    setCalendar(result.ok ? result.data : { configured: true, status: { state: 'error', reason: t.calendar.loadFailed }, events: [] })
  }, [])

  // 일정은 처음, 데이터가 바뀔 때, 그리고 1분마다 다시 읽는다(진행 중·지난 일정 표시도 함께 갱신).
  useEffect(() => {
    void loadCalendar()
    const timer = window.setInterval(() => void loadCalendar(), 60_000)
    return () => window.clearInterval(timer)
  }, [loadCalendar, refreshKey])

  async function reconnectCalendar(): Promise<void> {
    await safeInvoke(() => window.octopus.arms.connect('google-calendar'))
    void loadCalendar()
  }

  async function openCalendarEvent(id: string): Promise<void> {
    const result = await safeInvoke(() => window.octopus.calendar.openEvent(id))
    if (!result.ok) showNotice({ kind: 'error', text: t.calendar.openFailed })
  }

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
      case 'arms':
        return onNavigate('arms')
      case 'arm:google-calendar':
        return void window.octopus.calendar.openWeb()
      case 'calendar:local':
        return openDay(todayString())
      case 'arm:obsidian':
        return void window.octopus.obsidian.open()
      default:
        // 아직 없는 기능(지시하기·Arm·위키)은 쓸 수 없는 칸이라 여기까지 오지 않는다.
        return
    }
  }

  const slotInfos = useMemo(
    () => {
      // 바로가기를 한 번도 읽지 못했으면(실패) 예전처럼 빈 목록으로 칸을 그린다. 읽는 중이면 기다린다.
      const known = shortcuts ?? (shortcutsFailed ? [] : null)
      return pie.value && known ? describeSlots(pie.value, known, { command: commandReady, calendar: calendar?.configured === true && calendar.status.state === 'on', obsidian: obsidianOn }) : null
    },
    [pie.value, shortcuts, shortcutsFailed, commandReady, calendar, obsidianOn]
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
            onOpenTask={onOpenTask}
          />
        )
      case 'calendar':
        return (
          <CalendarCard
            calendar={calendar}
            refreshKey={refreshKey}
            today={today}
            selectedDay={selectedDay}
            onOpenDay={openDay}
            onReconnect={() => void reconnectCalendar()}
          />
        )
      case 'memo':
        return <MemoCard refreshKey={refreshKey} />
      case 'shortcuts':
        return (
          <ShortcutsCard
            shortcuts={shortcuts}
            loadFailed={shortcutsFailed}
            onChanged={() => void loadShortcuts()}
            onOpen={(id) => void openShortcut(id)}
          />
        )
    }
  }

  /** 카드 아래 고정 영역: "전체 보기 →" (스크롤 밖에 있다) */
  function renderFooter(card: CardId) {
    switch (card) {
      case 'todo':
        return (
          <button type="button" onClick={() => onNavigate('tasks')} className="self-start py-1 text-[13px] text-accent hover:underline">
            {t.todo.viewAll}
          </button>
        )
      case 'memo':
        return (
          <button type="button" onClick={() => onNavigate('memos')} className="self-start py-1 text-[13px] text-accent hover:underline">
            {t.memo.viewAll}
          </button>
        )
      default:
        return undefined
    }
  }

  // 좁은 창: 한 열로 쌓고(읽는 순서대로 위에서 아래), 목록은 격자 전체가 스크롤한다.
  const gridStyle: CSSProperties | undefined = narrow
    ? { gridTemplateColumns: '1fr', gridTemplateRows: 'repeat(4, auto)', rowGap: `${GAP_PX}px` }
    : layout
      ? {
          gridTemplateColumns: `${layout.col}fr ${GAP_PX}px ${100 - layout.col}fr`,
          gridTemplateRows: `${layout.row}fr ${GAP_PX}px ${100 - layout.row}fr`
        }
      : undefined

  return (
    <div className="relative flex h-full min-w-0 flex-col bg-page p-4 text-ink">
      {/* 날짜는 창 맨 위 제목 줄에 보인다. 화면 읽기 프로그램을 위해 홈 제목은 남겨 둔다. */}
      <h1 className="sr-only">{formatHomeDate(new Date())}</h1>

      {/* 배치 안내는 카드 자리를 밀지 않도록 아래쪽에 떠 있는 띠로 보인다. */}
      {arranging && (
        <div
          role="status"
          className="absolute bottom-4 left-1/2 z-[65] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent-strong shadow-lg ring-1 ring-[#c9c7f0]"
        >
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

      {layoutSaveFailed && <SaveFailedNotice onRetry={retryLayout} saving={layoutSaving} className="mb-2" />}

      {!layout ? (
        <div aria-busy="true" className="flex-1" />
      ) : (
        <div ref={gridRef} style={gridStyle} className={`relative grid min-h-0 flex-1 ${narrow ? 'overflow-y-auto' : ''}`}>
          {layout.order.map((card, position) => (
            <CardFrame
              key={card}
              card={card}
              position={position}
              arranging={arranging}
              onMove={(id: CardId, direction: Direction) => change(moveCard(layout, id, direction))}
              style={narrow ? { gridColumn: 1, gridRow: position + 1, minHeight: card === 'todo' ? NARROW_TODO_MIN_PX : undefined } : PLACEMENT[position]}
              footer={renderFooter(card)}
            >
              {renderCard(card)}
            </CardFrame>
          ))}

          {!narrow && (
            <>
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
            </>
          )}

          {/* 두 경계가 만나는 점의 원 버튼과 8칸 원형 메뉴. 크기를 조절하면 함께 움직인다. 좁은 창에서는 오른쪽 아래에 떠 있다. */}
          {slotInfos && (
            <PieMenu
              slots={slotInfos}
              onRun={runSlot}
              initialOpen={pieDemo !== undefined}
              initialHover={pieDemo?.hover ?? null}
              floating={narrow}
            />
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
      {dayTarget !== null && (
        <DayDialog
          key={dayOpening}
          startDate={dayTarget}
          onDateChange={setSelectedDay}
          today={today}
          now={now}
          calendar={calendar}
          refreshKey={refreshKey}
          onClose={() => setDayTarget(null)}
          onReconnect={() => void reconnectCalendar()}
          onOpenEvent={(id) => void openCalendarEvent(id)}
        />
      )}
      {dialog === 'memo' && (
        <MemoQuickDialog
          onClose={() => setDialog(null)}
          onSaved={(remaining) => {
            setRefreshKey((key) => key + 1)
            showNotice({ kind: 'info', text: t.dialogs.memoSaved })
            if (remaining === '') setDialog(null)
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

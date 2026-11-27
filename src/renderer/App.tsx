import { useEffect, useState } from 'react'
import type { TaskView } from '../shared/tasks/types'
import { CommandDialog } from './command/CommandDialog'
import { useModelStatus } from './command/useModelStatus'
import { HomeScreen } from './home/HomeScreen'
import { createLeaveGuardStore, LeaveGuardProvider, UnsavedStrip, type LeaveGuardStore } from './leaveGuard'
import { ko } from './i18n/ko'
import { MemosScreen } from './memos/MemosScreen'
import { TitleBar } from './layout/TitleBar'
import { NavMenu, type Screen } from './nav/NavMenu'
import { Welcome } from './onboarding/Welcome'
import { ArmsScreen } from './arms/ArmsScreen'
import { CalendarScreen } from './calendar/CalendarScreen'
import { ObsidianScreen } from './arms/ObsidianScreen'
import { RoutinesScreen } from './routines/RoutinesScreen'
import { SettingsScreen } from './settings/SettingsScreen'
import { useSetting } from './settings/useSetting'
import { TasksScreen } from './tasks/TasksScreen'
import { useNarrowWindow } from './layout/useNarrowWindow'

type InitialView = NonNullable<typeof window.octopus.initialView>

/** 앱을 켜면 홈. (개발용 캡처는 initialView 로 다른 화면을 바로 열 수 있다.) */
function initialScreen(initial: InitialView | null): Screen {
  if (initial === null || initial === 'home' || initial === 'home-arrange') return 'home'
  if (initial === 'routines' || initial === 'memos' || initial === 'settings') return initial
  if (initial === 'arms' || initial === 'arms-mcp') return 'arms'
  if (initial === 'obsidian') return 'obsidian'
  if (initial === 'home-pie' || initial === 'home-narrow' || initial === 'home-day' || initial === 'command' || initial === 'command-nokey' || initial === 'command-streaming') return 'home'
  return 'tasks'
}

/** 쓰던 내용을 확인하는 장치를 앱 전체에 한 개 둔다. 화면 안의 입력칸들이 여기에 등록한다. */
export function App() {
  const [guard] = useState<LeaveGuardStore>(createLeaveGuardStore)
  return (
    <LeaveGuardProvider value={guard}>
      <AppBody guard={guard} />
    </LeaveGuardProvider>
  )
}

function AppBody({ guard }: { guard: LeaveGuardStore }) {
  const initial = window.octopus.initialView
  const [screen, setScreen] = useState<Screen>(() => initialScreen(initial))
  const [arranging, setArranging] = useState(initial === 'home-arrange')
  // 메뉴 접힘은 알림 자리가 마땅치 않아, 저장에 실패하면 저장된 상태로 되돌린다.
  const nav = useSetting('nav.collapsed', { revertOnFailure: true })
  const narrow = useNarrowWindow()
  const [narrowExpanded, setNarrowExpanded] = useState(false)
  // 첫 실행 안내: 'checking'(아직 모름) → 'show' | 'hide'
  const [welcome, setWelcome] = useState<'checking' | 'show' | 'hide'>(typeof initial === 'string' && initial.startsWith('welcome-') ? 'show' : 'checking')
  const models = useModelStatus()
  const [commandOpen, setCommandOpen] = useState(initial === 'command' || initial === 'command-nokey' || initial === 'command-streaming')
  // 화면을 옮기려는데 쓰던 내용이 있으면 먼저 묻는다. 값은 옮길 화면.
  const [leaveAsk, setLeaveAsk] = useState<Screen | null>(null)

  // 날짜 상세(큰 대화상자)가 열려 있는지. 열려 있으면 지시하기 단축키를 무시해 모달이 겹치지 않게 한다.
  const [dayDialogOpen, setDayDialogOpen] = useState(false)

  // Ctrl+K(맥은 Cmd+K): 어느 화면에서든, 입력창에 글을 쓰는 중에도 지시하기를 연다. 날짜 상세가 열린 동안에는 무시한다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      if (dayDialogOpen) return
      event.preventDefault()
      setCommandOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dayDialogOpen])
  // 할 일 화면의 처음 보기. 상세 패널 캡처(task-detail)는 오늘 보기에서 연다.
  const taskView: TaskView | undefined = initialScreen(initial) === 'tasks' ? (initial === 'task-detail' ? 'today' : (initial as TaskView)) : undefined

  /** 실제로 화면을 옮긴다(확인이 끝난 뒤이거나, 확인할 것이 없을 때). */
  function go(next: Screen): void {
    setScreen(next)
    // 배치 모드는 홈에서만 의미가 있다.
    if (next !== 'home') setArranging(false)
  }

  /** 화면 옮기기 요청. 쓰던 내용이 있으면 확인 띠를 먼저 띄운다. */
  function navigate(next: Screen): void {
    if (next !== screen && guard.isDirty()) {
      setLeaveAsk(next)
      return
    }
    go(next)
  }

  // 안내를 보일지 정한다: 설정을 못 읽거나 끝냈다고 기록돼 있으면 안 보이고(앱을 막지 않는다),
  // 아니면 할 일·루틴·메모가 하나도 없는 새 사용자에게만 보인다. 이미 데이터가 있는 사용자는 안내를 보지 않고 "끝냄"으로 기록한다.
  useEffect(() => {
    if (welcome !== 'checking') return
    let cancelled = false
    const api = window.octopus
    void (async () => {
      const saved = await api.settings.get('onboarding.done')
      if (cancelled) return
      if (!saved.ok || saved.data === true) return void setWelcome('hide')
      const [lists, routines, memos] = await Promise.all([
        Promise.all((['inbox', 'today', 'upcoming', 'someday', 'done'] as const).map((view) => api.tasks.list(view))),
        api.routines.list(),
        api.memos.list()
      ])
      if (cancelled) return
      const taskCount = lists.reduce((sum, r) => {
        if (!r.ok) return sum + 1 // 못 읽으면 비어 있다고 단정하지 않는다
        return sum + (Array.isArray(r.data) ? r.data.length : r.data.overdue.length + r.data.today.length)
      }, 0)
      const empty = taskCount === 0 && routines.ok && routines.data.routines.length === 0 && memos.ok && memos.data.length === 0
      if (empty) setWelcome('show')
      else {
        void api.settings.set('onboarding.done', true)
        setWelcome('hide')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [welcome])

  function finishWelcome(): void {
    void window.octopus.settings.set('onboarding.done', true)
    setWelcome('hide')
    go('home')
  }

  // 메뉴 접힘 상태를 읽어 오기 전에는 틀만 보여 준다(펼쳤다가 접히는 깜빡임을 막는다).
  if (nav.value === null || welcome === 'checking') return (
    <div className="flex h-screen flex-col bg-page">
      <TitleBar />
    </div>
  )
  if (welcome === 'show') {
    const step = initial === 'welcome-2' ? 2 : initial === 'welcome-3' ? 3 : 1
    return (
      <div className="flex h-screen flex-col bg-page">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Welcome onDone={finishWelcome} initialStep={step} initialChosen={initial === 'welcome-1' || initial === 'welcome-2' ? ['obsidian'] : []} />
        </div>
      </div>
    )
  }

  // 좁은 창에서는 메뉴를 접힌 모양으로 보인다. 사용자가 저장해 둔 선택은 바꾸지 않고, ☰ 는 이 창 안에서만 펼쳤다 접는다.
  const collapsed = narrow ? !narrowExpanded : nav.value
  function toggleCollapsed(): void {
    if (narrow) return setNarrowExpanded((on) => !on)
    nav.setLocal(!nav.value)
    nav.persist(!nav.value)
  }

  return (
    <div className="relative flex h-screen flex-col bg-page text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <NavMenu
          screen={screen}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onNavigate={navigate}
          arranging={arranging}
          onToggleArranging={() => setArranging((on) => !on)}
          onOpenCommand={() => setCommandOpen(true)}
          commandReady={models.connected}
        />
        {/* 화면이 바뀔 때만 새로 그린다. 데이터가 바뀌면 각 화면이 스스로 다시 읽는다(쓰던 입력은 그대로 둔다). */}
        <main key={screen} className="min-h-0 min-w-0 flex-1 border-l border-[#dad9d4] bg-white">
          {screen === 'home' && (
            <HomeScreen
              arranging={arranging}
              onDoneArranging={() => setArranging(false)}
              onNavigate={navigate}
              onOpenCommand={() => setCommandOpen(true)}
              commandReady={models.connected}
              pieDemo={initial === 'home-pie' ? { hover: 1 } : undefined}
              dayDemo={initial === 'home-day'}
              onDayDialogChange={setDayDialogOpen}
            />
          )}
          {screen === 'calendar' && <CalendarScreen />}
          {screen === 'tasks' && <TasksScreen initialView={taskView} openFirst={initial === 'task-detail'} />}
          {screen === 'routines' && <RoutinesScreen />}
          {screen === 'memos' && <MemosScreen />}
          {screen === 'arms' && <ArmsScreen scrollToMcp={initial === 'arms-mcp'} onOpenSettings={(name) => name === 'obsidian' && navigate('obsidian')} />}
          {screen === 'obsidian' && <ObsidianScreen onBack={() => navigate('arms')} />}
          {screen === 'settings' && <SettingsScreen />}
        </main>
      </div>
      {leaveAsk !== null && (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-md">
            <UnsavedStrip
              title={ko.home.localCalendar.discardTitle}
              onKeep={() => setLeaveAsk(null)}
              onDiscard={() => {
                setLeaveAsk(null)
                go(leaveAsk)
              }}
            />
          </div>
        </div>
      )}
      {commandOpen && (
        <CommandDialog
          openLatest={initial === 'command'}
          autoSend={initial === 'command-streaming' ? '오늘 할 일을 정리해 줘' : undefined}
          onClose={() => setCommandOpen(false)}
          onOpenSettings={() => {
            setCommandOpen(false)
            navigate('settings')
          }}
        />
      )}
    </div>
  )
}

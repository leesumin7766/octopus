import { useEffect, useState } from 'react'
import type { TaskView } from '../shared/tasks/types'
import { CommandDialog } from './command/CommandDialog'
import { useModelStatus } from './command/useModelStatus'
import { useDataChanged } from './dataEvents'
import { HomeScreen } from './home/HomeScreen'
import { MemosScreen } from './memos/MemosScreen'
import { NavMenu, type Screen } from './nav/NavMenu'
import { RoutinesScreen } from './routines/RoutinesScreen'
import { SettingsScreen } from './settings/SettingsScreen'
import { useSetting } from './settings/useSetting'
import { TasksScreen } from './tasks/TasksScreen'

type InitialView = NonNullable<typeof window.octopus.initialView>

/** 앱을 켜면 홈. (개발용 캡처는 initialView 로 다른 화면을 바로 열 수 있다.) */
function initialScreen(initial: InitialView | null): Screen {
  if (initial === null || initial === 'home' || initial === 'home-arrange') return 'home'
  if (initial === 'routines' || initial === 'memos' || initial === 'settings') return initial
  if (initial === 'home-pie' || initial === 'command' || initial === 'command-nokey') return 'home'
  return 'tasks'
}

export function App() {
  const initial = window.octopus.initialView
  const [screen, setScreen] = useState<Screen>(() => initialScreen(initial))
  const [arranging, setArranging] = useState(initial === 'home-arrange')
  const nav = useSetting('nav.collapsed')
  const models = useModelStatus()
  const [commandOpen, setCommandOpen] = useState(initial === 'command' || initial === 'command-nokey')
  // 지시하기가 데이터를 바꾸면 뒤의 화면이 새로 읽도록 key 를 바꿔 다시 그린다.
  const [dataVersion, setDataVersion] = useState(0)
  useDataChanged(() => setDataVersion((v) => v + 1))

  // Ctrl+K(맥은 Cmd+K): 어느 화면에서든, 입력창에 글을 쓰는 중에도 지시하기를 연다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setCommandOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
  const taskView: TaskView | undefined = initialScreen(initial) === 'tasks' ? (initial as TaskView) : undefined

  function navigate(next: Screen): void {
    setScreen(next)
    // 배치 모드는 홈에서만 의미가 있다.
    if (next !== 'home') setArranging(false)
  }

  // 메뉴 접힘 상태를 읽어 오기 전에는 틀만 보여 준다(펼쳤다가 접히는 깜빡임을 막는다).
  if (nav.value === null) return <div className="h-screen bg-page" />

  const collapsed = nav.value
  function toggleCollapsed(): void {
    nav.setLocal(!collapsed)
    nav.persist(!collapsed)
  }

  return (
    <div className="flex h-screen bg-page text-ink">
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
      <main key={dataVersion} className="min-h-0 min-w-0 flex-1 border-l border-[#dad9d4] bg-white">
        {screen === 'home' && (
          <HomeScreen
            arranging={arranging}
            onDoneArranging={() => setArranging(false)}
            onNavigate={navigate}
            onOpenCommand={() => setCommandOpen(true)}
            commandReady={models.connected}
            pieDemo={initial === 'home-pie' ? { hover: 1 } : undefined}
          />
        )}
        {screen === 'tasks' && <TasksScreen initialView={taskView} />}
        {screen === 'routines' && <RoutinesScreen />}
        {screen === 'memos' && <MemosScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
      {commandOpen && (
        <CommandDialog
          openLatest={initial === 'command'}
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

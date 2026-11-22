import { useState } from 'react'
import type { TaskView } from '../shared/tasks/types'
import { ko } from './i18n/ko'
import { MemosScreen } from './memos/MemosScreen'
import { RoutinesScreen } from './routines/RoutinesScreen'
import { TasksScreen } from './tasks/TasksScreen'

type Tab = 'tasks' | 'routines' | 'memos'

const TABS: readonly Tab[] = ['tasks', 'routines', 'memos']

// 임시 화면 전환(탭). 홈 화면과 왼쪽 메뉴가 생기면 이 자리는 그쪽으로 교체된다.
export function App() {
  const initial = window.octopus.initialView
  const [tab, setTab] = useState<Tab>(initial === 'routines' || initial === 'memos' ? initial : 'tasks')
  const taskView: TaskView | undefined = initial && initial !== 'routines' && initial !== 'memos' ? initial : undefined

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <div role="tablist" aria-label={ko.tabs.label} className="flex gap-1 border-b border-slate-200 bg-white px-3 pt-2">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`rounded-t-md px-4 py-2 text-sm ${
              tab === name
                ? 'border-b-2 border-indigo-600 font-semibold text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {ko.tabs[name]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {tab === 'tasks' && <TasksScreen initialView={taskView} />}
        {tab === 'routines' && <RoutinesScreen />}
        {tab === 'memos' && <MemosScreen />}
      </div>
    </div>
  )
}

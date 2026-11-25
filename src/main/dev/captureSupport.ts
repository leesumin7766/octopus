import { resolve } from 'node:path'
import type { HomeLayout } from '../../shared/home/layout'
import { parseInitialView, type InitialView } from '../../shared/initialView'
import type { RoutineInput } from '../../shared/routines/types'
import { addDays, weekdayOf } from '../../shared/tasks/dates'
import type { TaskInput } from '../../shared/tasks/types'
import type { MemoRepository } from '../core/memos/memoRepository'
import type { RoutineRepository } from '../core/routines/routineRepository'
import type { SettingsRepository } from '../core/settings/settingsRepository'
import type { ShortcutRepository } from '../core/shortcuts/shortcutRepository'
import type { TaskRepository } from '../core/tasks/taskRepository'

// 개발용 화면 캡처의 순수한 부분. electron 을 쓰지 않아 테스트할 수 있다.

/** png 를 저장할 경로. 있을 때만 캡처 모드가 켜진다. */
export const CAPTURE_ENV = 'OCTOPUS_CAPTURE'
/** 처음 보여 줄 화면(할 일 보기 5종, routines, memos). 없거나 틀리면 today. */
export const CAPTURE_VIEW_ENV = 'OCTOPUS_CAPTURE_VIEW'

export interface CaptureConfig {
  outputPath: string
  view: InitialView
}

/**
 * 환경 변수에서 캡처 설정을 읽는다. 배포된(packaged) 앱에서는 항상 null 이다.
 * 아무 파일이나 덮어쓰지 않도록 .png 경로만 받는다.
 */
export function readCaptureConfig(env: NodeJS.ProcessEnv, isPackaged: boolean): CaptureConfig | null {
  if (isPackaged) return null

  const output = env[CAPTURE_ENV]
  if (!output || !output.toLowerCase().endsWith('.png')) return null

  return { outputPath: resolve(output), view: parseInitialView(env[CAPTURE_VIEW_ENV]) ?? 'today' }
}

/**
 * 캡처용 표본 할 일. today 를 기준으로 날짜를 잡는다.
 * 지난 할 일 2 · 오늘 3 · 반복 1(오늘 날짜) · 예정 2 · 수신함 1.
 */
export function buildSampleTasks(today: string): TaskInput[] {
  return [
    // 지난 할 일
    { title: '지난주 회의록 정리', date: addDays(today, -3), priority: 2, project: '업무' },
    { title: '병원 예약 확인 전화', date: addDays(today, -1), time: '10:00', deadline: addDays(today, -1) },
    // 오늘
    { title: '주간 보고서 작성', date: today, time: '15:00', priority: 3, project: '업무', deadline: addDays(today, 2) },
    { title: '장보기: 우유, 달걀', date: today },
    { title: '운동 30분', date: today, time: '19:30', priority: 1, project: '건강' },
    // 반복
    { title: '영어 단어 20개 외우기', date: today, repeat: { freq: 'daily', interval: 1 } },
    // 예정
    { title: '치과 정기검진', date: addDays(today, 3), time: '14:00' },
    { title: '분기 계획 발표 준비', date: addDays(today, 7), priority: 2, project: '업무' },
    // 수신함
    { title: '새 노트북 알아보기' }
  ]
}

/** 표본 할 일을 저장소에 넣는다. */
export function createSampleTasks(repo: Pick<TaskRepository, 'create' | 'setStatus'>, today: string): void {
  for (const input of buildSampleTasks(today)) repo.create(input)
  // 완료 보기 표본: 오늘 끝낸 것 두 개(완료 시각이 함께 보인다).
  for (const title of ['물 두 잔 마시기', '책 10쪽 읽기']) {
    const task = repo.create({ title, date: today })
    repo.setStatus(task.id, 'done')
  }
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]

/** 캡처용 표본 루틴. 첫 번째는 매일이라 어느 요일에 찍어도 오늘 항목이 있다. */
export const SAMPLE_ROUTINES: readonly RoutineInput[] = [
  { title: '아침 스트레칭', days: EVERY_DAY },
  { title: '영어 공부 30분', days: WEEKDAYS },
  { title: '저녁 일기 쓰기', days: EVERY_DAY }
]

/** 캡처용 표본 메모. pin 은 고정, toTask 는 할 일로 만들어 연결한다. */
export const SAMPLE_MEMOS: readonly { body: string; pin?: boolean; toTask?: boolean }[] = [
  { body: '장보기 목록\n- 우유\n- 달걀\n- 식빵', pin: true },
  { body: '다음 주 팀 회의 안건\n1. 분기 계획 점검\n2. 일정 조율\n3. 휴가 일정 공유' },
  { body: '내일 오후 3시 치과 예약 전화하기', toTask: true }
]

/** 캡처용 표본 바로가기: 링크 2개. (폴더 하나는 createSampleData 가 받은 경로로 만든다.) 화면에 보이기만 하고 열지는 않는다. */
export const SAMPLE_SHORTCUT_URLS: readonly { url: string; label: string }[] = [
  { url: 'https://developer.mozilla.org/ko/', label: 'MDN 문서' },
  { url: 'https://www.wikipedia.org/', label: '위키백과' }
]

/** 배치 모드 캡처(home-arrange)에서 보여 줄 배치: 메모 카드를 위로 올리고 경계를 옮겨 둔다. */
export const SAMPLE_LAYOUT: HomeLayout = { version: 1, order: ['todo', 'memo', 'calendar', 'shortcuts'], col: 62, row: 42 }

/** 캡처 화면에 맞는 설정을 (임시 userData 의) 설정 저장소에 넣는다. */
export function seedCaptureSettings(settings: Pick<SettingsRepository, 'set'>, view: InitialView): void {
  if (view === 'home-arrange') settings.set('home.layout', SAMPLE_LAYOUT)
}

/** 캡처용으로 거슬러 올라가 기록을 만들 날 수 */
const HISTORY_DAYS = 6

export interface SampleRepos {
  tasks: Pick<TaskRepository, 'create' | 'setStatus'>
  routines: Pick<RoutineRepository, 'create' | 'todayItems'>
  memos: Pick<MemoRepository, 'create' | 'togglePin' | 'toTask'>
  shortcuts: Pick<ShortcutRepository, 'createUrl' | 'createPath'>
}

/**
 * 캡처용 표본 전체: 할 일, 루틴 3개(첫 번째는 오늘 완료, 지난 며칠의 기록 포함), 메모 3개
 * (하나는 고정, 하나는 할 일로 연결), 바로가기 3개(링크 2·폴더 1). today 는 YYYY-MM-DD,
 * folderPath 는 폴더 바로가기가 가리킬 절대 경로(열지 않는다).
 */
export function createSampleData(repos: SampleRepos, today: string, folderPath: string): void {
  createSampleTasks(repos.tasks, today)

  const routines = SAMPLE_ROUTINES.map((input) => repos.routines.create(input, today))

  // 오늘 항목: 첫 번째 루틴은 완료해 둔다.
  const first = repos.routines.todayItems(today).find((task) => task.routineId === routines[0].id)
  if (first) repos.tasks.setStatus(first.id, 'done')

  // 지난 며칠의 기록: 해당 요일마다 항목을 만들고 일부는 끝내지 못한 채로 둔다.
  for (let back = 1; back <= HISTORY_DAYS; back++) {
    const date = addDays(today, -back)
    routines.forEach((routine, index) => {
      if (!routine.days.includes(weekdayOf(date))) return
      const past = repos.tasks.create({ title: routine.title, bucket: 'scheduled', date, routineId: routine.id })
      if ((index + back) % 3 !== 0) repos.tasks.setStatus(past.id, 'done')
    })
  }

  for (const sample of SAMPLE_SHORTCUT_URLS) repos.shortcuts.createUrl(sample)
  repos.shortcuts.createPath({ path: folderPath, pathType: 'folder', label: '문서 폴더' })

  for (const sample of SAMPLE_MEMOS) {
    const memo = repos.memos.create(sample.body)
    if (sample.pin) repos.memos.togglePin(memo.id)
    if (sample.toTask) repos.memos.toTask(memo.id, today)
  }
}

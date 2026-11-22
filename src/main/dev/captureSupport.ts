import { resolve } from 'node:path'
import { addDays } from '../../shared/tasks/dates'
import type { TaskInput, TaskView } from '../../shared/tasks/types'
import { parseView } from '../../shared/validation/taskIpc'
import type { TaskRepository } from '../core/tasks/taskRepository'

// 개발용 화면 캡처의 순수한 부분. electron 을 쓰지 않아 테스트할 수 있다.

/** png 를 저장할 경로. 있을 때만 캡처 모드가 켜진다. */
export const CAPTURE_ENV = 'OCTOPUS_CAPTURE'
/** 처음 보여 줄 보기. 없거나 틀리면 today. */
export const CAPTURE_VIEW_ENV = 'OCTOPUS_CAPTURE_VIEW'

export interface CaptureConfig {
  outputPath: string
  view: TaskView
}

/**
 * 환경 변수에서 캡처 설정을 읽는다. 배포된(packaged) 앱에서는 항상 null 이다.
 * 아무 파일이나 덮어쓰지 않도록 .png 경로만 받는다.
 */
export function readCaptureConfig(env: NodeJS.ProcessEnv, isPackaged: boolean): CaptureConfig | null {
  if (isPackaged) return null

  const output = env[CAPTURE_ENV]
  if (!output || !output.toLowerCase().endsWith('.png')) return null

  const view = parseView(env[CAPTURE_VIEW_ENV])
  return { outputPath: resolve(output), view: view.ok ? view.value : 'today' }
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
export function createSampleTasks(repo: Pick<TaskRepository, 'create'>, today: string): void {
  for (const input of buildSampleTasks(today)) repo.create(input)
}

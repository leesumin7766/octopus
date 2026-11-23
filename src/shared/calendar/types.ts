import type { IpcResult } from '../ipc'
import type { ArmStatus } from '../arms/types'

/** 오늘 일정 한 개. 일정은 보기만 한다(할 일로 만들지 않는다). 제목은 외부 데이터라 화면에서 글자로만 그린다. */
export interface CalendarEvent {
  id: string
  title: string
  /** 종일이면 'YYYY-MM-DD', 아니면 ISO 시각 */
  start: string
  /** 종일이면 'YYYY-MM-DD'(끝나는 날의 다음 날, Google 방식), 아니면 ISO 시각 */
  end: string
  allDay: boolean
  /** 원본 일정 주소(https 만). 열기는 id 로만 한다. */
  url: string | null
}

export interface CalendarToday {
  /** 이 빌드(또는 고급 설정)에 Google 연결 정보가 있는지 */
  configured: boolean
  /** configured 가 false 일 때 보여 줄 안내 */
  unavailableReason?: string
  status: ArmStatus
  /** 연결돼 있을 때만 채워진다 */
  events: CalendarEvent[]
}

export interface CalendarApi {
  today(): Promise<IpcResult<CalendarToday>>
  /** id 로 찾은 일정의 원본 주소를 main 이 https 인지 확인한 뒤 기본 브라우저로 연다. */
  openEvent(id: string): Promise<IpcResult<null>>
  /** Google 캘린더 웹(고정 주소)을 연다. */
  openWeb(): Promise<IpcResult<null>>
}

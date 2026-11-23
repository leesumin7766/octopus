import type { CalendarEvent, CalendarToday } from '../../../shared/calendar/types'
import type { ArmManager } from '../sdk/manager'
import { GOOGLE_CALENDAR_ID, type GoogleCalendarArm } from './index'

/** 오늘 일정을 화면에 주는 쪽이 아는 모양. 진짜는 Arm 관리자+Arm, 캡처에서는 가짜 데이터. */
export interface CalendarProvider {
  today(): CalendarToday
  findEvent(id: string): CalendarEvent | undefined
}

export function createCalendarProvider(manager: ArmManager, arm: GoogleCalendarArm): CalendarProvider {
  return {
    today() {
      const info = manager.get(GOOGLE_CALENDAR_ID)
      if (!info) return { configured: false, status: { state: 'off' }, events: [] }
      return {
        configured: !info.unavailableReason,
        ...(info.unavailableReason ? { unavailableReason: info.unavailableReason } : {}),
        status: info.status,
        events: info.status.state === 'on' ? arm.todayEvents() : []
      }
    },
    findEvent: (id) => arm.todayEvents().find((e) => e.id === id)
  }
}

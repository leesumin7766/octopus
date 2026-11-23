import { describe, expect, it, vi } from 'vitest'
import type { CalendarProvider } from '../../src/main/arms/google-calendar/provider'
import { createCalendarHandlers, GOOGLE_CALENDAR_WEB, registerCalendarHandlers } from '../../src/main/ipc/calendar'
import type { CalendarEvent, CalendarToday } from '../../src/shared/calendar/types'
import { IPC } from '../../src/shared/ipc'

const ev = (id: string, url: string | null): CalendarEvent => ({ id, title: 't', start: '2026-03-10', end: '2026-03-11', allDay: true, url })

function setup(events: CalendarEvent[], today?: Partial<CalendarToday>) {
  const opened: string[] = []
  const logged: unknown[] = []
  const provider: CalendarProvider = {
    today: () => ({ configured: true, status: { state: 'on' }, events, ...today }),
    findEvent: (id) => events.find((e) => e.id === id)
  }
  const handlers = createCalendarHandlers({ getProvider: () => provider, openExternal: async (u) => void opened.push(u), logError: (_c, e) => void logged.push(e) })
  return { handlers, opened, logged }
}

describe('calendar IPC', () => {
  it('today returns the provider state; without a provider it says "off", not an error', () => {
    expect(setup([ev('a', null)]).handlers.today()).toMatchObject({ ok: true, data: { configured: true, status: { state: 'on' }, events: [{ id: 'a' }] } })
    const none = createCalendarHandlers({ getProvider: () => null, openExternal: async () => {}, logError: () => {} })
    expect(none.today()).toEqual({ ok: true, data: { configured: false, status: { state: 'off' }, events: [] } })
  })

  it('openEvent opens only the stored https address of that event, by id', async () => {
    const { handlers, opened } = setup([ev('a', 'https://calendar.example.com/a'), ev('nolink', null), ev('plain', 'http://calendar.example.com/p'), ev('js', 'javascript:alert(1)')])

    expect(await handlers.openEvent('a')).toEqual({ ok: true, data: null })
    expect(opened).toEqual(['https://calendar.example.com/a'])

    expect(await handlers.openEvent('nolink')).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await handlers.openEvent('missing')).toEqual({ ok: false, error: { code: 'not_found' } })
    expect(await handlers.openEvent('plain')).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    expect(await handlers.openEvent('js')).toMatchObject({ ok: false })
    expect(opened).toHaveLength(1)
  })

  it('openEvent validates the id shape, and an address is never accepted in its place', async () => {
    const { handlers, opened } = setup([ev('a', 'https://calendar.example.com/a')])
    for (const bad of [5, null, '', '../x', 'https://evil.example/', 'a b', 'x'.repeat(201)]) {
      expect(await handlers.openEvent(bad)).toMatchObject({ ok: false, error: { code: 'invalid_input', fields: ['id'] } })
    }
    expect(opened).toEqual([])
  })

  it('openWeb opens the fixed Google Calendar address and nothing else', async () => {
    const { handlers, opened } = setup([])
    expect(await handlers.openWeb()).toEqual({ ok: true, data: null })
    expect(opened).toEqual([GOOGLE_CALENDAR_WEB])
    expect(GOOGLE_CALENDAR_WEB).toBe('https://calendar.google.com/')
  })

  it('a failing browser launch is an internal error without details', async () => {
    const logged: unknown[] = []
    const handlers = createCalendarHandlers({ getProvider: () => null, openExternal: async () => { throw new Error('C:\secret\path') }, logError: (_c, e) => void logged.push(e) })
    const r = await handlers.openWeb()
    expect(r).toEqual({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(logged).toHaveLength(1)
  })

  it('registers exactly the three calendar channels', () => {
    const handle = vi.fn()
    registerCalendarHandlers({ handle }, setup([]).handlers)
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual([IPC.calendarToday, IPC.calendarOpenEvent, IPC.calendarOpenWeb].sort())
  })
})

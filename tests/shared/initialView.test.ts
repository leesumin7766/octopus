import { describe, expect, it } from 'vitest'
import { INITIAL_VIEW_ARG, initialViewArgument, parseInitialView, readInitialView } from '../../src/shared/initialView'

describe('initial view argument', () => {
  it('round-trips each view', () => {
    for (const view of ['inbox', 'today', 'upcoming', 'someday', 'done'] as const) {
      expect(readInitialView(['electron', initialViewArgument(view)])).toBe(view)
    }
  })

  it('also accepts the checklist and memo screens', () => {
    expect(readInitialView([initialViewArgument('routines')])).toBe('routines')
    expect(readInitialView([initialViewArgument('memos')])).toBe('memos')
    expect(parseInitialView('routines')).toBe('routines')
    expect(parseInitialView('tasks')).toBeNull()
    expect(parseInitialView(undefined)).toBeNull()
  })

  it('is null when missing or invalid', () => {
    expect(readInitialView([])).toBeNull()
    expect(readInitialView(['electron', '--other=1'])).toBeNull()
    expect(readInitialView([`${INITIAL_VIEW_ARG}weekly`])).toBeNull()
    expect(readInitialView([INITIAL_VIEW_ARG])).toBeNull()
  })
})

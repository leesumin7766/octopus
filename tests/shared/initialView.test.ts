import { describe, expect, it } from 'vitest'
import { INITIAL_VIEW_ARG, initialViewArgument, readInitialView } from '../../src/shared/initialView'

describe('initial view argument', () => {
  it('round-trips each view', () => {
    for (const view of ['inbox', 'today', 'upcoming', 'someday', 'done'] as const) {
      expect(readInitialView(['electron', initialViewArgument(view)])).toBe(view)
    }
  })

  it('is null when missing or invalid', () => {
    expect(readInitialView([])).toBeNull()
    expect(readInitialView(['electron', '--other=1'])).toBeNull()
    expect(readInitialView([`${INITIAL_VIEW_ARG}weekly`])).toBeNull()
    expect(readInitialView([INITIAL_VIEW_ARG])).toBeNull()
  })
})

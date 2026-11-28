// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCompleteWithUndo } from '../../src/renderer/tasks/useCompleteWithUndo'

// 옛 알림의 만료가 새 알림을 지우지 않는다: 새 알림이 뜬 뒤에 옛 알림의 onExpire 가 불려도(정리가 늦게 도는 경우) 새 알림은 남는다.
const expiries = new Map<string, () => void>()

vi.mock('../../src/renderer/ui/ActionNotice', () => ({
  ActionNotice: ({ message, onExpire }: { message: string; onExpire: () => void }) => {
    expiries.set(message, onExpire)
    return <div role="status">{message}</div>
  }
}))

let show!: (message: string) => void

function Harness() {
  const completion = useCompleteWithUndo({ onSaved: () => undefined, onFailed: () => undefined })
  show = (message) => completion.showUndo(message, async () => ({ ok: false, error: { code: 'internal' } }))
  return <>{completion.undoNotice()}</>
}

describe('useCompleteWithUndo notice expiry', () => {
  afterEach(() => {
    cleanup()
    expiries.clear()
  })

  it('an old notice expiring after a newer one appeared does not remove the newer one', () => {
    render(<Harness />)
    act(() => show('첫 알림'))
    const oldExpire = expiries.get('첫 알림')!
    act(() => show('둘째 알림'))
    expect(screen.getByRole('status').textContent).toBe('둘째 알림')

    act(() => oldExpire())
    expect(screen.getByRole('status').textContent).toBe('둘째 알림')

    act(() => expiries.get('둘째 알림')!())
    expect(screen.queryByRole('status')).toBeNull()
  })
})

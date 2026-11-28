// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { installBackend, type Backend } from './backend'

// F2: 네 화면(할 일 탭·홈·날짜 상세·체크리스트) 모두 같은 규칙:
// 체크 → 바로 줄 긋기 → 같은 모양의 되돌리기 알림 → [되돌리기] → 미완료. 저장 실패 → 체크가 풀리고 오류. 느린 저장 중 연타 → 요청 한 번.
// 2026-11-25(수) 정오.
const t = ko.tasks
const TODAY = '2026-11-25'

describe('check and undo, the same on every screen', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0))
  })

  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const statusOf = (id: string): string | undefined => b.t.repo.get(id)?.status
  const noticeButton = (): HTMLElement => within(screen.getByRole('status')).getByRole('button', { name: t.undo.button })
  const gate = (): { wait: Promise<void>; release: () => void } => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => (release = resolve))
    return { wait, release }
  }

  /** 화면마다 다른 부분: 어떻게 열고, 체크칸이 뭐고, 오류가 어디 뜨는지 */
  const screens = [
    {
      name: 'tasks tab',
      open: async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
        b = installBackend('today')
        b.t.repo.create({ title: '탭 보고서', date: TODAY })
        render(<App />)
        await screen.findByText('탭 보고서')
      },
      box: (): HTMLInputElement => screen.getByRole('checkbox', { name: `${t.complete}: 탭 보고서` }) as HTMLInputElement,
      title: '탭 보고서',
      // 이 화면은 체크하면 흐려진 뒤 목록에서 사라진다
      removed: true
    },
    {
      name: 'home card',
      open: async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
        b = installBackend('home')
        b.t.repo.create({ title: '홈 보고서', date: TODAY })
        render(<App />)
        await within(await screen.findByRole('region', { name: ko.home.cards.todo })).findByText('홈 보고서')
      },
      box: (): HTMLInputElement => screen.getByRole('checkbox', { name: `${t.complete}: 홈 보고서` }) as HTMLInputElement,
      title: '홈 보고서',
      removed: true
    },
    {
      name: 'day detail',
      open: async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
        b = installBackend('home')
        b.t.repo.create({ title: '상세 보고서', date: TODAY })
        render(<App />)
        await waitFor(() => expect(document.querySelector(`[data-date="${TODAY}"]`)).toBeTruthy())
        await user.click(document.querySelector(`[data-date="${TODAY}"]`) as HTMLElement)
        await screen.findByRole('dialog')
        await waitFor(() => expect(screen.getByRole('checkbox', { name: ko.home.localCalendar.toggleLabel('상세 보고서') })).toBeTruthy())
      },
      box: (): HTMLInputElement => screen.getByRole('checkbox', { name: ko.home.localCalendar.toggleLabel('상세 보고서') }) as HTMLInputElement,
      title: '상세 보고서',
      removed: false
    },
    {
      name: 'checklist',
      open: async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
        b = installBackend('home')
        b.routineRepo.create({ title: '체크 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] }, TODAY)
        render(<App />)
        await user.click(await screen.findByRole('button', { name: ko.nav.routines }))
        await waitFor(() => expect(screen.getByRole('checkbox', { name: `${t.complete}: 체크 스트레칭` })).toBeTruthy())
      },
      box: (): HTMLInputElement => screen.getByRole('checkbox', { name: `${t.complete}: 체크 스트레칭` }) as HTMLInputElement,
      title: '체크 스트레칭',
      removed: false
    }
  ] as const

  describe.each(screens)('$name', (screenCase) => {
    const taskIdOf = (): string => {
      const found = b.t.repo.listRange(TODAY, TODAY).find((task) => task.title === screenCase.title)
      if (!found) throw new Error('task not found')
      return found.id
    }

    it('check → struck out at once → undo notice → [되돌리기] → open again', async () => {
      const user = userEvent.setup()
      await screenCase.open(user)
      const id = taskIdOf()

      await user.click(screenCase.box())
      expect((await screen.findByRole('status')).textContent).toContain(t.undo.done(screenCase.title))
      expect(statusOf(id)).toBe('done')

      await user.click(noticeButton())
      await waitFor(() => expect(statusOf(id)).toBe('open'))
      await waitFor(() => expect(screenCase.box().checked).toBe(false))
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('a failed save releases the check and shows an error', async () => {
      const user = userEvent.setup()
      await screenCase.open(user)
      b.tasks.setStatus.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } })

      await user.click(screenCase.box())

      expect(await screen.findByRole('alert')).toBeTruthy()
      await waitFor(() => expect(screenCase.box().checked).toBe(false))
      expect(statusOf(taskIdOf())).toBe('open')
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('rapid clicks during a slow save send one request', async () => {
      const user = userEvent.setup()
      await screenCase.open(user)
      const real = b.tasks.setStatus.getMockImplementation()!
      const slow = gate()
      b.tasks.setStatus.mockImplementationOnce(async (id: unknown, status: unknown) => {
        await slow.wait
        return real(id as never, status as never)
      })
      const calls = b.tasks.setStatus.mock.calls.length

      const box = screenCase.box()
      await user.click(box)
      await user.click(box)
      await user.click(box)
      expect(b.tasks.setStatus.mock.calls.length - calls).toBe(1)

      await act(async () => slow.release())
      await waitFor(() => expect(statusOf(taskIdOf())).toBe('done'))
      expect(b.tasks.setStatus.mock.calls.length - calls).toBe(1)
    })

    it('rapid clicks on [되돌리기] send one request', async () => {
      const user = userEvent.setup()
      await screenCase.open(user)
      await user.click(screenCase.box())
      await screen.findByRole('status')
      const real = b.tasks.setStatus.getMockImplementation()!
      const slow = gate()
      b.tasks.setStatus.mockImplementationOnce(async (id: unknown, status: unknown) => {
        await slow.wait
        return real(id as never, status as never)
      })
      const calls = b.tasks.setStatus.mock.calls.length
      const button = noticeButton()
      await user.click(button)
      await user.click(button).catch(() => undefined)
      expect(b.tasks.setStatus.mock.calls.length - calls).toBe(1)
      await act(async () => slow.release())
      await waitFor(() => expect(statusOf(taskIdOf())).toBe('open'))
    })
  })

  describe('day detail and checklist keep the struck row; clicking again clears without a new notice', () => {
    it('day detail', async () => {
      const user = userEvent.setup()
      await screens[2].open(user)
      await user.click(screens[2].box())
      await waitFor(() => expect(screens[2].box().checked).toBe(true))
      expect(screens[2].box()).toBeTruthy() // 목록에 남는다
      await user.click(screens[2].box())
      await waitFor(() => expect(screens[2].box().checked).toBe(false))
    })

    it('checklist', async () => {
      const user = userEvent.setup()
      await screens[3].open(user)
      await user.click(screens[3].box())
      await waitFor(() => expect(screens[3].box().checked).toBe(true))
      await user.click(screens[3].box())
      await waitFor(() => expect(screens[3].box().checked).toBe(false))
    })
  })

  it('tasks tab: undoing "안 하기" uses the same notice shape', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    const task = b.t.repo.create({ title: '안 할 보고서', date: TODAY })
    render(<App />)
    await user.click(await screen.findByText('안 할 보고서'))
    const panel = await screen.findByRole('complementary', { name: t.detail.title })
    await user.click(within(panel).getByRole('button', { name: t.detail.cancelTask }))
    expect((await screen.findByRole('status')).textContent).toContain(t.undo.canceled('안 할 보고서'))
    await user.click(noticeButton())
    await waitFor(() => expect(statusOf(task.id)).toBe('open'))
  })

  it('a repeating task: check then undo leaves exactly one open copy', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    b.t.repo.create({ title: '반복 청소', date: TODAY, repeat: { freq: 'daily', interval: 1 } })
    render(<App />)
    await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 반복 청소` }))
    await screen.findByRole('status')
    await user.click(noticeButton())
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await waitFor(() => {
      const open = b.t.repo.listRange('2026-11-01', '2026-12-31').filter((task) => task.title === '반복 청소' && task.status === 'open')
      expect(open).toHaveLength(1)
    })
  })

  it('a newer notice replaces the older one (only one at a time)', async () => {
    const user = userEvent.setup()
    b = installBackend('today')
    b.t.repo.create({ title: '먼저 할 일 정리', date: TODAY })
    b.t.repo.create({ title: '나중 할 일 정리', date: TODAY })
    render(<App />)
    await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 먼저 할 일 정리` }))
    await user.click(await screen.findByRole('checkbox', { name: `${t.complete}: 나중 할 일 정리` }))
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1))
    expect(screen.getByRole('status').textContent).toContain(t.undo.done('나중 할 일 정리'))
  })
})

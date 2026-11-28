// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArmError } from '../../src/main/arms/sdk/types'
import { App } from '../../src/renderer/App'
import { ko } from '../../src/renderer/i18n/ko'
import { formatDate, todayString } from '../../src/renderer/tasks/format'
import { fakeArm } from '../arms/helpers'
import { installBackend, type Backend } from './backend'

const t = ko.arms
const ct = ko.tasks.candidates

describe('Arms screen', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const prepare = (): Backend => (b = installBackend('arms'))
  const show = (): void => void render(<App />)
  const card = (name: string): Promise<HTMLElement> => screen.findByRole('article', { name: t.cardLabel(name) })

  it('with no arm registered it says so, shows no made-up cards, and keeps the MCP placeholder', async () => {
    prepare()
    show()

    expect(await screen.findByText(t.empty)).toBeTruthy()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(screen.getByRole('region', { name: t.mcp.title }).textContent).toContain(t.mcp.empty)
    for (const name of ['Slack', 'GitHub', 'Google', 'Gmail']) expect(screen.queryByText(new RegExp(name))).toBeNull()
  })

  it('shows only the registered arms, each with name, status and description (no capability chips or sign-in footnote)', async () => {
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { id: 'one', name: '예시 하나', auth: 'oauth', scopes: ['x'], capabilities: ['tasks.import', 'events.read'], description: '설명 한 줄' } }))
    show()

    const c = await card('예시 하나')

    expect(within(c).getByText(t.statuses.off)).toBeTruthy()
    expect(within(c).getByText('설명 한 줄')).toBeTruthy()
    expect(within(c).queryByText(t.capabilities['tasks.import'])).toBeNull()
    expect(within(c).queryByText('로그인 한 번으로 연결')).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('off: [연결] only. Clicking connects and the card turns to "연결됨" with [연결 끊기] instead', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { name: '예시 하나' } }))
    show()
    const c = await card('예시 하나')
    expect(within(c).queryByRole('button', { name: t.disconnect })).toBeNull()

    await user.click(within(c).getByRole('button', { name: t.connect }))

    await waitFor(() => expect(within(c).getByText(t.statuses.on)).toBeTruthy())
    expect(backend.arms.connect).toHaveBeenCalledWith('test-arm')
    expect(within(c).getByRole('button', { name: t.disconnect })).toBeTruthy()
    expect(within(c).queryByRole('button', { name: t.connect })).toBeNull()
  })

  it('while connecting the button is locked and says so', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    let release: () => void = () => {}
    backend.armManager.register(fakeArm({ manifest: { name: '예시 하나' }, connect: () => new Promise<void>((r) => (release = r)) }))
    show()
    const c = await card('예시 하나')

    await user.click(within(c).getByRole('button', { name: t.connect }))

    const locked = (await within(c).findByRole('button', { name: t.connecting })) as HTMLButtonElement
    expect(locked.disabled).toBe(true)
    release()
    await waitFor(() => expect(within(c).getByText(t.statuses.on)).toBeTruthy())
  })

  it('error: shows the reason and [다시 연결]; pressing it connects again', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    let fail = true
    backend.armManager.register(
      fakeArm({
        manifest: { name: '예시 하나' },
        connect: async () => {
          if (fail) throw new ArmError('로그인이 만료됐어요. 다시 로그인해 주세요.')
        }
      })
    )
    show()
    const c = await card('예시 하나')

    await user.click(within(c).getByRole('button', { name: t.connect }))

    expect((await within(c).findByRole('alert')).textContent).toBe('로그인이 만료됐어요. 다시 로그인해 주세요.')
    expect(within(c).getByText(t.statuses.error)).toBeTruthy()
    expect(within(c).queryByRole('button', { name: t.connect })).toBeNull()

    fail = false
    await user.click(within(c).getByRole('button', { name: t.reconnect }))

    await waitFor(() => expect(within(c).getByText(t.statuses.on)).toBeTruthy())
    expect(within(c).queryByRole('alert')).toBeNull()
  })

  it('disconnecting asks first ("저장된 로그인 정보가 삭제돼요. 할 일은 그대로 남아요."); cancel keeps it, confirm disconnects', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { name: '예시 하나' }, connect: async (ctx) => ctx.secrets.set('token', 'T') }))
    backend.t.repo.create({ title: '내 할 일' })
    show()
    const c = await card('예시 하나')
    await user.click(within(c).getByRole('button', { name: t.connect }))
    await waitFor(() => expect(within(c).getByText(t.statuses.on)).toBeTruthy())

    await user.click(within(c).getByRole('button', { name: t.disconnect }))
    expect(within(c).getByRole('alert').textContent).toContain('저장된 로그인 정보가 삭제돼요. 할 일은 그대로 남아요.')
    expect(backend.arms.disconnect).not.toHaveBeenCalled()
    await user.click(within(c).getByRole('button', { name: t.disconnectNo }))
    expect(within(c).getByText(t.statuses.on)).toBeTruthy()

    await user.click(within(c).getByRole('button', { name: t.disconnect }))
    await user.click(within(c).getByRole('button', { name: t.disconnectYes }))

    await waitFor(() => expect(within(c).getByText(t.statuses.off)).toBeTruthy())
    expect(backend.arms.disconnect).toHaveBeenCalledWith('test-arm')
    expect(backend.t.repo.listView('inbox', '2026-03-10').map((x) => x.title)).toEqual(['내 할 일']) // 할 일은 그대로
  })

  it('the auto-accept switch appears on a connected arm that can import tasks, and is saved', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { name: '예시 하나' } }))
    backend.armManager.register(fakeArm({ manifest: { id: 'no-import', name: '읽기 전용', capabilities: ['events.read'] } }))
    show()
    const c = await card('예시 하나')
    expect(within(c).queryByRole('checkbox')).toBeNull() // 연결 전에는 없다
    await user.click(within(c).getByRole('button', { name: t.connect }))
    const box = (await within(c).findByRole('checkbox', { name: t.autoAccept })) as HTMLInputElement
    expect(box.checked).toBe(false)

    await user.click(box)

    await waitFor(() => expect(backend.arms.setAutoAccept).toHaveBeenCalledWith('test-arm', true))
    await waitFor(() => expect((within(c).getByRole('checkbox') as HTMLInputElement).checked).toBe(true))

    const other = await card('읽기 전용')
    await user.click(within(other).getByRole('button', { name: t.connect }))
    await waitFor(() => expect(within(other).getByText(t.statuses.on)).toBeTruthy())
    expect(within(other).queryByRole('checkbox')).toBeNull()
  })

  it('a broken arm does not take the rest of the app down (tasks still work)', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    backend.armManager.register(fakeArm({ manifest: { name: '예시 하나' }, connect: async () => { throw new Error('boom') } }))
    show()
    const c = await card('예시 하나')
    await user.click(within(c).getByRole('button', { name: t.connect }))
    await within(c).findByRole('alert')

    await user.click(within(screen.getByRole('navigation', { name: ko.nav.label })).getByRole('button', { name: ko.nav.tasks }))

    expect(await screen.findByLabelText(ko.tasks.quickInputLabel)).toBeTruthy()
  })
})

describe('Inbox: incoming candidates', () => {
  let b: Backend

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
  })
  afterEach(() => {
    cleanup()
    b?.t.db.close()
    vi.useRealTimers()
  })

  const prepare = (view: 'inbox' | 'today' = 'inbox'): Backend => {
    b = installBackend(view)
    b.armManager.register(fakeArm({ manifest: { id: 'example', name: '예시 Arm' } }))
    return b
  }
  const section = (n: number): Promise<HTMLElement> => screen.findByRole('region', { name: ct.title(n) })
  const add = (ref: string, title: string, extra: { url?: string; dueDate?: string; notes?: string } = {}): void => void b.candidateRepo.add('example', { ref, title, ...extra })

  it('shows nothing when there are no candidates', async () => {
    prepare()
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: ko.tasks.views.inbox })
    expect(screen.queryByRole('region', { name: /들어온 후보/ })).toBeNull()
  })

  it('lists candidates at the top of the inbox only: count, source arm name, title, due date, link button', async () => {
    prepare()
    add('r1', '견적서 회신', { url: 'https://example.com/1', dueDate: '2026-03-12' })
    add('r2', '자료 확인')
    render(<App />)

    const s = await section(2)

    expect(within(s).getAllByRole('listitem')).toHaveLength(2)
    expect(within(s).getByText('견적서 회신')).toBeTruthy()
    expect(within(s).getAllByText(new RegExp(ct.from('예시 Arm')))).toHaveLength(2)
    // 마감은 ISO 날짜가 아니라 사람이 읽는 표기로 보인다(오늘과 같은 해면 연도 없음)
    expect(s.textContent).toContain(ct.due(formatDate('2026-03-12', todayString())))
    expect(s.textContent).not.toContain('2026-03-12')
    expect(within(s).getByRole('button', { name: ct.openLabel('견적서 회신') })).toBeTruthy()
    expect(within(s).queryByRole('button', { name: ct.openLabel('자료 확인') })).toBeNull() // 링크 없는 후보
    // 할 일 목록보다 위에 있다.
    expect(screen.queryByText(ko.tasks.empty.inbox) ?? screen.getByText(ko.tasks.views.inbox)).toBeTruthy()
  })

  it('is not shown on the other views', async () => {
    prepare('today')
    add('r1', '견적서 회신')
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: ko.tasks.views.today })
    expect(screen.queryByRole('region', { name: /들어온 후보/ })).toBeNull()
  })

  it('[수신함에 넣기] turns it into an inbox task right away and removes it from the candidate list', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    add('r1', '견적서 회신')
    add('r2', '자료 확인')
    render(<App />)
    const s = await section(2)

    await user.click(within(s).getByRole('button', { name: ct.acceptLabel('견적서 회신') }))

    await waitFor(() => expect(screen.getByRole('region', { name: ct.title(1) })).toBeTruthy())
    const list = await screen.findByRole('list', { name: ko.tasks.listLabel })
    expect(within(list).getByText('견적서 회신')).toBeTruthy()
    expect(backend.t.repo.listView('inbox', '2026-03-10')).toMatchObject([{ title: '견적서 회신', source: { arm: 'example', ref: 'r1' } }])
  })

  it('[무시] hides it for good (the same source sent again does not come back) and makes no task', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    add('r1', '견적서 회신')
    render(<App />)
    const s = await section(1)

    await user.click(within(s).getByRole('button', { name: ct.dismissLabel('견적서 회신') }))

    await waitFor(() => expect(screen.queryByRole('region', { name: /들어온 후보/ })).toBeNull())
    add('r1', '견적서 회신')
    expect(backend.candidateRepo.listPending()).toEqual([])
    expect(backend.t.repo.listView('inbox', '2026-03-10')).toHaveLength(0)
  })

  it('[전체 넣기] and [전체 무시] handle everything', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    for (const r of ['1', '2', '3']) add(r, `일 ${r}`)
    render(<App />)
    await user.click(within(await section(3)).getByRole('button', { name: ct.acceptAll }))
    await waitFor(() => expect(backend.t.repo.listView('inbox', '2026-03-10')).toHaveLength(3))
    await waitFor(() => expect(screen.queryByRole('region', { name: /들어온 후보/ })).toBeNull())

    for (const r of ['4', '5']) add(r, `일 ${r}`)
    cleanup()
    render(<App />)
    await user.click(within(await section(2)).getByRole('button', { name: ct.dismissAll }))
    await waitFor(() => expect(screen.queryByRole('region', { name: /들어온 후보/ })).toBeNull())
    expect(backend.t.repo.listView('inbox', '2026-03-10')).toHaveLength(3)
  })

  it('[원본 열기] asks main to open the stored address by id (the screen sends no address)', async () => {
    const user = userEvent.setup()
    const backend = prepare()
    add('r1', '견적서 회신', { url: 'https://example.com/1' })
    render(<App />)
    const s = await section(1)

    await user.click(within(s).getByRole('button', { name: ct.openLabel('견적서 회신') }))

    await waitFor(() => expect(backend.opened).toEqual(['https://example.com/1']))
    const sent = backend.candidates.openSource.mock.calls[0][0]
    expect(sent).toBe(backend.candidateRepo.listPending()[0].id)
  })

  it('shows hostile titles and notes as plain text — no HTML, no scripts', async () => {
    prepare()
    const evil = '<img src=x onerror="window.__pwned=1"><b>굵게</b>'
    add('r1', evil, { notes: '<script>window.__pwned=2</script>' })
    render(<App />)
    const s = await section(1)

    expect(s.textContent).toContain(evil)
    expect(s.querySelector('img, b, script')).toBeNull()
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('auto-accept: a candidate sent while it is on goes straight into the inbox as a task, no candidate card', async () => {
    const backend = prepare()
    backend.armManager.setAutoAccept('example', true)
    add('r1', '자동으로 들어옴')
    // add() 는 자동 수락 여부를 모른다(Arm 관리자의 coreFor 가 정한다) — 관리자가 쓰는 경로로 넣는다.
    const arm = fakeArm({ manifest: { id: 'auto-arm', name: '자동 Arm' }, connect: async (ctx) => void ctx.core.addInboxCandidate({ ref: 'a1', title: '자동 수락 후보' }) })
    backend.armManager.register(arm)
    backend.armManager.setAutoAccept('auto-arm', true)
    await backend.armManager.connect('auto-arm')

    render(<App />)

    expect(await screen.findByText('자동 수락 후보')).toBeTruthy()
    expect(backend.t.repo.listView('inbox', '2026-03-10').map((x) => x.title)).toContain('자동 수락 후보')
    expect(backend.candidateRepo.listPending().map((c) => c.title)).not.toContain('자동 수락 후보')
  })
})

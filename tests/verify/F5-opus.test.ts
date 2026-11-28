// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
// F5 독립 검증(Opus): 상세 패널에 '보관함' 칸이 없고, 보관함은 날짜·반복으로 저절로 정해진다. [나중에로] 버튼.
import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../src/shared/ipc'
import type { Task, TaskFields } from '../../src/shared/tasks/types'
import { ko } from '../../src/renderer/i18n/ko'
// .tsx 를 이 폴더의 타입 검사(JSX 없음)에 끌어들이지 않도록 경로를 변수로 불러온다(다른 검증 테스트와 같은 방식).
let DetailPanel: ComponentType<any>
beforeAll(async () => {
  const p = '../../src/renderer/tasks/DetailPanel'
  DetailPanel = (await import(p)).DetailPanel
})

const t = ko.tasks.detail

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '01TESTTASK0000000000000000',
    title: '검증 일',
    notes: '',
    status: 'open',
    bucket: 'inbox',
    date: null,
    time: null,
    deadline: null,
    priority: 0,
    project: null,
    tags: [],
    repeat: null,
    routineId: null,
    source: null,
    order: 0,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
    doneAt: null,
    ...overrides
  }
}

type Save = (patch: Partial<TaskFields>) => Promise<IpcResult<Task>>

function renderPanel(target: Task, onSave: Save) {
  const spy = vi.fn(onSave)
  render(createElement(DetailPanel, { task: target, onSave: spy, onRemove: async () => {}, onCancel: async () => {}, onClose: () => {} }))
  return spy
}

const ok: Save = async (patch) => ({ ok: true, data: task(patch as Partial<Task>) })
const someday = (): HTMLElement | null => screen.queryByRole('button', { name: t.moveToSomeday })
const save = (): HTMLElement => screen.getByRole('button', { name: t.save })

afterEach(() => cleanup())

describe('F5 (Opus)', () => {
  it('no 보관함 field or wording anywhere in the panel', () => {
    renderPanel(task(), ok)
    expect(document.querySelector('#task-bucket')).toBeNull()
    expect(document.body.textContent).not.toContain('보관함')
  })

  it('inbox task + date → saved as scheduled with that date', async () => {
    const user = userEvent.setup()
    const spy = renderPanel(task(), ok)
    fireEvent.change(screen.getByLabelText(t.date), { target: { value: '2026-03-20' } })
    await user.click(save())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0]).toMatchObject({ bucket: 'scheduled', date: '2026-03-20' })
  })

  it('scheduled task with date cleared → inbox, date and time null, no error shown', async () => {
    const user = userEvent.setup()
    const spy = renderPanel(task({ bucket: 'scheduled', date: '2026-03-12', time: '09:00' }), ok)
    fireEvent.change(screen.getByLabelText(t.date), { target: { value: '' } })
    await user.click(save())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0]).toMatchObject({ bucket: 'inbox', date: null })
    expect(screen.queryByText(ko.tasks.fieldErrors.date)).toBeNull()
  })

  it('someday task: editing the title keeps someday; adding a date makes it scheduled', async () => {
    const user = userEvent.setup()
    const spy = renderPanel(task({ bucket: 'someday' }), ok)
    await user.type(screen.getByLabelText(t.titleField), '!')
    await user.click(save())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0]).toMatchObject({ bucket: 'someday', date: null, title: '검증 일!' })

    cleanup()
    const spy2 = renderPanel(task({ bucket: 'someday' }), ok)
    fireEvent.change(screen.getByLabelText(t.date), { target: { value: '2026-04-01' } })
    await user.click(save())
    await waitFor(() => expect(spy2).toHaveBeenCalledTimes(1))
    expect(spy2.mock.calls[0][0]).toMatchObject({ bucket: 'scheduled', date: '2026-04-01' })
  })

  it('[나중에로] sends someday with date and time cleared', async () => {
    const user = userEvent.setup()
    const spy = renderPanel(task({ bucket: 'scheduled', date: '2026-03-12', time: '09:00' }), ok)
    await user.click(someday()!)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0]).toMatchObject({ bucket: 'someday', date: null, time: null, repeat: null })
  })

  it('[나중에로] during a slow save: double click sends one request, both buttons locked until it ends', async () => {
    const user = userEvent.setup()
    let finish!: (r: IpcResult<Task>) => void
    const spy = renderPanel(task(), () => new Promise((resolve) => (finish = resolve)))
    await user.click(someday()!)
    await user.click(someday()!)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((someday() as HTMLButtonElement).disabled).toBe(true)
    finish({ ok: true, data: task({ bucket: 'someday' }) })
    await waitFor(() => expect((someday() as HTMLButtonElement).disabled).toBe(false))
  })

  it('[나중에로] with an empty title: invalid_input is shown on the field and the panel stays', async () => {
    const user = userEvent.setup()
    const spy = renderPanel(task(), async () => ({ ok: false, error: { code: 'invalid_input', fields: ['title'] } }))
    await user.clear(screen.getByLabelText(t.titleField))
    await user.click(someday()!)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(ko.tasks.fieldErrors.title)).toBeTruthy()
    expect(screen.getByLabelText(t.titleField)).toBeTruthy()
  })

  it('[나중에로] is hidden for routine items, repeating tasks, and tasks already someday', () => {
    renderPanel(task({ routineId: 'r1', bucket: 'scheduled', date: '2026-03-10' }), ok)
    expect(someday()).toBeNull()
    expect(screen.getByText(t.routineLocksDate)).toBeTruthy()
    cleanup()
    renderPanel(task({ bucket: 'scheduled', date: '2026-03-10', repeat: { freq: 'daily', interval: 1 } }), ok)
    expect(someday()).toBeNull()
    cleanup()
    renderPanel(task({ bucket: 'someday' }), ok)
    expect(someday()).toBeNull()
  })

  it('turning on repeat for an inbox task hides [나중에로] and saves as scheduled with a date', async () => {
    const user = userEvent.setup()
    const spy = renderPanel(task(), ok)
    expect(someday()).not.toBeNull()
    fireEvent.change(screen.getByLabelText(t.repeat), { target: { value: 'daily' } })
    expect(someday()).toBeNull()
    await user.click(save())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const patch = spy.mock.calls[0][0]
    expect(patch.bucket).toBe('scheduled')
    expect(patch.date).not.toBeNull()
  })

  it('the panel buttons region still renders the 저장 button inside the form', () => {
    renderPanel(task(), ok)
    const form = save().closest('form')
    expect(form).not.toBeNull()
    expect(within(form as HTMLElement).queryByRole('combobox', { name: '보관함' })).toBeNull()
  })
})

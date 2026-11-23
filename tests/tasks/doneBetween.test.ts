import { describe, expect, it } from 'vitest'
import { createTestRepo } from './helpers'

describe('listDoneBetween', () => {
  it('returns finished tasks (routine items too) whose completion time is inside the range, oldest first', () => {
    const t = createTestRepo('2026-03-10T09:00:00.000Z')
    const a = t.repo.create({ title: '일반', date: '2026-03-10', bucket: 'scheduled' })
    const routine = t.repo.create({ title: '루틴', date: '2026-03-10', bucket: 'scheduled', routineId: 'R1' })
    const open = t.repo.create({ title: '안 끝남' })
    t.repo.setStatus(a.id, 'done')
    t.setNow('2026-03-10T10:00:00.000Z')
    t.repo.setStatus(routine.id, 'done')

    const inside = t.repo.listDoneBetween('2026-03-10T00:00:00.000Z', '2026-03-11T00:00:00.000Z')

    expect(inside.map((x) => x.title)).toEqual(['일반', '루틴'])
    expect(inside.some((x) => x.id === open.id)).toBe(false)
    expect(t.repo.listDoneBetween('2026-03-11T00:00:00.000Z', '2026-03-12T00:00:00.000Z')).toEqual([])
    expect(t.repo.listDoneBetween('2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z')).toEqual([]) // 끝 시각은 포함하지 않는다
    t.db.close()
  })
})

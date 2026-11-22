import { afterEach, describe, expect, it } from 'vitest'
import { MAX_TITLE_FROM_MEMO, MemoNotFoundError, splitMemoForTask } from '../../src/main/core/memos/memoRepository'
import { MAX_MEMO_LENGTH, MemoValidationError } from '../../src/shared/validation/memo'
import { createMemoEnv, type MemoEnv } from './helpers'

const TODAY = '2026-03-10' // 화요일
const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const at = (day: number, hour = 12): string => new Date(2026, 2, day, hour, 0, 0).toISOString()

describe('memo repository', () => {
  let env: MemoEnv | undefined

  function setup(wrap?: Parameters<typeof createMemoEnv>[1]): MemoEnv {
    env = createMemoEnv(undefined, wrap)
    return env
  }

  afterEach(() => {
    env?.t.db.close()
    env = undefined
  })

  const count = (e: MemoEnv, table: 'memos' | 'tasks'): number =>
    (e.t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  describe('create / get', () => {
    it('stores the body exactly as written (markdown source, newlines and trailing spaces)', () => {
      const e = setup()
      const body = '# 제목\n\n- 항목 1\n- 항목 2  \n\n<b>태그처럼 보여도 그냥 글자</b>\n'

      const memo = e.memos.create(body)

      expect(memo).toMatchObject({ body, pinned: false, taskId: null })
      expect(memo.createdAt).toBe(memo.updatedAt)
      expect(memo.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(e.memos.get(memo.id)).toEqual(memo)
    })

    it('rejects blank, non-string and too long bodies, storing nothing', () => {
      const e = setup()

      for (const body of ['', '   \n ', 5, null, undefined, 'x'.repeat(MAX_MEMO_LENGTH + 1)]) {
        expect(() => e.memos.create(body as never)).toThrow(MemoValidationError)
      }
      expect(count(e, 'memos')).toBe(0)
    })

    it('accepts a body at the length limit', () => {
      const e = setup()

      expect(e.memos.create('x'.repeat(MAX_MEMO_LENGTH)).body).toHaveLength(MAX_MEMO_LENGTH)
    })

    it('returns undefined for an unknown id', () => {
      expect(setup().memos.get(MISSING)).toBeUndefined()
    })
  })

  describe('update', () => {
    it('changes the body and refreshes updatedAt', () => {
      const e = setup()
      const memo = e.memos.create('처음')
      e.setNow(at(11))

      const updated = e.memos.update(memo.id, '고친 뒤')

      expect(updated).toMatchObject({ body: '고친 뒤', createdAt: memo.createdAt, updatedAt: at(11) })
    })

    it('keeps updatedAt when nothing changed', () => {
      const e = setup()
      const memo = e.memos.create('같은 글')
      e.setNow(at(11))

      expect(e.memos.update(memo.id, '같은 글')).toEqual(memo)
    })

    it('rejects a blank body and an unknown id without changing anything', () => {
      const e = setup()
      const memo = e.memos.create('원본')

      expect(() => e.memos.update(memo.id, '  ')).toThrow(MemoValidationError)
      expect(() => e.memos.update(MISSING, '내용')).toThrow(MemoNotFoundError)
      expect(e.memos.get(memo.id)).toEqual(memo)
    })

    it('keeps the pin and the task link', () => {
      const e = setup()
      const memo = e.memos.create('첫 줄')
      e.memos.togglePin(memo.id)
      const { task } = e.memos.toTask(memo.id, TODAY)

      const updated = e.memos.update(memo.id, '고친 글')

      expect(updated).toMatchObject({ pinned: true, taskId: task.id })
    })
  })

  describe('remove', () => {
    it('deletes the memo, reports whether it existed, and leaves the linked task alone', () => {
      const e = setup()
      const memo = e.memos.create('할 일로 만들 메모')
      const { task } = e.memos.toTask(memo.id, TODAY)

      expect(e.memos.remove(memo.id)).toBe(true)
      expect(e.memos.remove(memo.id)).toBe(false)

      expect(e.memos.get(memo.id)).toBeUndefined()
      expect(e.t.repo.get(task.id)).toBeDefined()
    })
  })

  describe('list order', () => {
    it('pinned memos first, then the most recently updated', () => {
      const e = setup()
      e.setNow(at(1))
      const oldest = e.memos.create('가장 오래됨')
      e.setNow(at(2))
      const middle = e.memos.create('중간')
      e.setNow(at(3))
      const newest = e.memos.create('가장 최근')
      e.memos.togglePin(oldest.id)

      expect(e.memos.list().map((m) => m.id)).toEqual([oldest.id, newest.id, middle.id])
    })

    it('editing moves a memo to the top of its group', () => {
      const e = setup()
      e.setNow(at(1))
      const a = e.memos.create('a')
      e.setNow(at(2))
      const b = e.memos.create('b')
      e.setNow(at(3))
      e.memos.update(a.id, 'a 수정')

      expect(e.memos.list().map((m) => m.id)).toEqual([a.id, b.id])
    })

    it('pinned memos are ordered among themselves by updatedAt', () => {
      const e = setup()
      e.setNow(at(1))
      const a = e.memos.create('a')
      e.setNow(at(2))
      const b = e.memos.create('b')
      e.memos.togglePin(a.id)
      e.memos.togglePin(b.id)

      expect(e.memos.list().map((m) => m.id)).toEqual([b.id, a.id])
    })

    it('memos made at the same moment have a stable order (newest id first)', () => {
      const e = setup()
      const first = e.memos.create('첫째')
      const second = e.memos.create('둘째')

      expect(e.memos.list().map((m) => m.id)).toEqual([second.id, first.id])
    })
  })

  describe('search', () => {
    function seed(e: MemoEnv) {
      e.setNow(at(1))
      const shopping = e.memos.create('장보기 목록\n우유, 달걀')
      e.setNow(at(2))
      const meeting = e.memos.create('팀 회의 안건\n분기 계획')
      e.setNow(at(3))
      const percent = e.memos.create('할인율 30% 확인')
      e.setNow(at(4))
      const under = e.memos.create('file_name 정리')
      e.setNow(at(5))
      const english = e.memos.create('Quarterly REPORT draft')
      return { shopping, meeting, percent, under, english }
    }

    it('finds memos that contain the text anywhere', () => {
      const e = setup()
      const { shopping, meeting } = seed(e)

      expect(e.memos.search('달걀').map((m) => m.id)).toEqual([shopping.id])
      expect(e.memos.search('안건').map((m) => m.id)).toEqual([meeting.id])
      expect(e.memos.search('계획').map((m) => m.id)).toEqual([meeting.id])
      expect(e.memos.search('없는 낱말')).toEqual([])
    })

    it('ignores case for English letters', () => {
      const e = setup()
      const { english } = seed(e)

      expect(e.memos.search('report').map((m) => m.id)).toEqual([english.id])
      expect(e.memos.search('QUARTERLY').map((m) => m.id)).toEqual([english.id])
    })

    it('treats % and _ as plain characters', () => {
      const e = setup()
      const { percent, under } = seed(e)

      expect(e.memos.search('%').map((m) => m.id)).toEqual([percent.id])
      expect(e.memos.search('30%').map((m) => m.id)).toEqual([percent.id])
      expect(e.memos.search('_').map((m) => m.id)).toEqual([under.id])
      expect(e.memos.search('e_n').map((m) => m.id)).toEqual([under.id])
      expect(e.memos.search('!')).toEqual([])
    })

    it('a blank query returns everything in list order', () => {
      const e = setup()
      seed(e)

      expect(e.memos.search('').map((m) => m.id)).toEqual(e.memos.list().map((m) => m.id))
      expect(e.memos.search('   ').map((m) => m.id)).toEqual(e.memos.list().map((m) => m.id))
    })

    it('keeps pinned results first', () => {
      const e = setup()
      e.setNow(at(1))
      const old = e.memos.create('회의 메모 하나')
      e.setNow(at(2))
      const recent = e.memos.create('회의 메모 둘')
      e.memos.togglePin(old.id)

      expect(e.memos.search('회의').map((m) => m.id)).toEqual([old.id, recent.id])
    })
  })

  describe('togglePin', () => {
    it('flips the pin each time without touching updatedAt', () => {
      const e = setup()
      const memo = e.memos.create('핀')
      e.setNow(at(12))

      const pinned = e.memos.togglePin(memo.id)
      expect(pinned).toMatchObject({ pinned: true, updatedAt: memo.updatedAt })

      const unpinned = e.memos.togglePin(memo.id)
      expect(unpinned).toMatchObject({ pinned: false, updatedAt: memo.updatedAt })
    })

    it('throws for an unknown id', () => {
      expect(() => setup().memos.togglePin(MISSING)).toThrow(MemoNotFoundError)
    })
  })

  describe('toTask', () => {
    it('uses the first line as the title (with date, time, project and priority parsed), the rest as notes', () => {
      const e = setup()
      const memo = e.memos.create('내일 오후 3시 치과 예약 #건강 !높음\n전화번호 확인\n\n두 번째 문단')

      const result = e.memos.toTask(memo.id, TODAY)

      expect(result.task).toMatchObject({
        title: '치과 예약',
        notes: '전화번호 확인\n\n두 번째 문단',
        date: '2026-03-11',
        time: '15:00',
        project: '건강',
        priority: 3,
        bucket: 'scheduled',
        status: 'open'
      })
      expect(result.memo).toMatchObject({ id: memo.id, taskId: result.task.id })
      expect(e.memos.get(memo.id)?.taskId).toBe(result.task.id)
      expect(e.t.repo.get(result.task.id)).toEqual(result.task)
    })

    it('a one-line memo has empty notes and lands in the inbox when it has no date', () => {
      const e = setup()
      const memo = e.memos.create('  새 노트북 알아보기  ')

      const { task } = e.memos.toTask(memo.id, TODAY)

      expect(task).toMatchObject({ title: '새 노트북 알아보기', notes: '', bucket: 'inbox', date: null })
    })

    it('can create a repeating task from the first line', () => {
      const e = setup()
      const memo = e.memos.create('매주 월 주간 회의')

      expect(e.memos.toTask(memo.id, TODAY).task).toMatchObject({
        title: '주간 회의',
        date: '2026-03-16',
        repeat: { freq: 'weekly', interval: 1, byWeekday: [1] }
      })
    })

    it('does not keep the memo body in the title when the first line is only a date', () => {
      const e = setup()
      const memo = e.memos.create('내일\n준비물: 신분증')

      expect(e.memos.toTask(memo.id, TODAY).task).toMatchObject({ title: '내일', date: '2026-03-11', notes: '준비물: 신분증' })
    })

    it('cuts a very long first line at 200 characters and moves the rest to the notes', () => {
      const e = setup()
      const long = '가'.repeat(MAX_TITLE_FROM_MEMO) + '나나나'
      const memo = e.memos.create(`${long}\n둘째 줄`)

      const { task } = e.memos.toTask(memo.id, TODAY)

      expect(task.title).toBe('가'.repeat(MAX_TITLE_FROM_MEMO))
      expect(task.notes).toBe('나나나\n둘째 줄')
    })

    it('handles Windows line endings', () => {
      const e = setup()
      const memo = e.memos.create('제목 줄\r\n본문 줄')

      expect(e.memos.toTask(memo.id, TODAY).task).toMatchObject({ title: '제목 줄', notes: '본문 줄' })
    })

    it('refuses a memo that already has a task, and makes no second task', () => {
      const e = setup()
      const memo = e.memos.create('한 번만')
      e.memos.toTask(memo.id, TODAY)

      expect(() => e.memos.toTask(memo.id, TODAY)).toThrow(MemoValidationError)

      expect(count(e, 'tasks')).toBe(1)
    })

    it('a memo can be turned into a task again after its task was deleted', () => {
      const e = setup()
      const memo = e.memos.create('다시 만들 메모')
      const first = e.memos.toTask(memo.id, TODAY).task
      e.t.repo.remove(first.id)
      expect(e.memos.get(memo.id)?.taskId).toBeNull()

      const second = e.memos.toTask(memo.id, TODAY).task

      expect(second.id).not.toBe(first.id)
      expect(e.memos.get(memo.id)?.taskId).toBe(second.id)
    })

    it('throws for an unknown memo and a malformed today', () => {
      const e = setup()
      const memo = e.memos.create('메모')

      expect(() => e.memos.toTask(MISSING, TODAY)).toThrow(MemoNotFoundError)
      expect(() => e.memos.toTask(memo.id, '내일')).toThrow(MemoValidationError)
      expect(count(e, 'tasks')).toBe(0)
    })

    it('is one transaction: if anything fails after the task is made, no task is left and the memo is unlinked', () => {
      const e = setup((tasks) => ({
        ...tasks,
        create(input) {
          tasks.create(input) // 할 일은 만들어졌는데…
          throw new Error('boom') // …그 직후에 실패
        }
      }))
      const memo = e.memos.create('실패할 메모')

      expect(() => e.memos.toTask(memo.id, TODAY)).toThrow('boom')

      expect(count(e, 'tasks')).toBe(0)
      expect(e.memos.get(memo.id)?.taskId).toBeNull()
    })
  })
})

describe('splitMemoForTask', () => {
  it('splits on the first line break', () => {
    expect(splitMemoForTask('제목\n본문')).toEqual({ title: '제목', notes: '본문' })
    expect(splitMemoForTask('제목만')).toEqual({ title: '제목만', notes: '' })
    expect(splitMemoForTask('\n\n  제목  \n\n  본문  \n')).toEqual({ title: '제목', notes: '본문' })
  })
})

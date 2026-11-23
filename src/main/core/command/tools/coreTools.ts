import type { Task, TaskView } from '../../../../shared/tasks/types'
import { parseQuickInput } from '../../../../shared/tasks/quickParse'
import { isValidDateString, isValidTimeString } from '../../../../shared/validation/task'
import type { MemoRepository } from '../../memos/memoRepository'
import type { RoutineRepository } from '../../routines/routineRepository'
import type { TaskRepository } from '../../tasks/taskRepository'
import { isRecord, stringField, type CommandTool } from './registry'

export interface CoreToolDeps {
  tasks: TaskRepository
  memos: MemoRepository
  routines: Pick<RoutineRepository, 'todayItems'>
  today: () => string
}

const VIEWS: readonly TaskView[] = ['inbox', 'today', 'upcoming', 'someday', 'done']
const MAX_LIST = 50

const obj = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false
})

function line(t: Task): string {
  const when = t.date ? ` (${t.date}${t.time ? ' ' + t.time : ''})` : ''
  return `- [${t.status === 'done' ? 'x' : ' '}] ${t.title}${when} id=${t.id}`
}

/** 코어(할 일·메모) 도구. Arm 을 모른다. */
export function createCoreTools(deps: CoreToolDeps): CommandTool[] {
  const listTasks: CommandTool<TaskView> = {
    name: 'list_tasks',
    description: '할 일 목록을 본다. view: inbox(수신함) | today(오늘, 지난 것 포함) | upcoming(예정) | someday(나중에) | done(완료).',
    inputSchema: obj({ view: { type: 'string', enum: [...VIEWS] } }),
    readOnly: true,
    parse(raw) {
      const view = isRecord(raw) ? raw.view : undefined
      return VIEWS.includes(view as TaskView) ? { ok: true, value: view as TaskView } : { ok: false, message: `view must be one of ${VIEWS.join(', ')}` }
    },
    run(view) {
      const day = deps.today()
      let tasks: Task[]
      let header = ''
      if (view === 'today') {
        const v = deps.tasks.listView('today', day)
        tasks = [...v.overdue, ...v.today]
        header = `지난 할 일 ${v.overdue.length}개 포함. `
      } else tasks = deps.tasks.listView(view, day)
      const shown = tasks.slice(0, MAX_LIST)
      return `${header}${tasks.length}개${tasks.length > shown.length ? ` 중 ${shown.length}개` : ''}\n${shown.map(line).join('\n')}`.trim()
    }
  }

  const searchMemos: CommandTool<string> = {
    name: 'search_memos',
    description: '메모를 글자로 찾는다.',
    inputSchema: obj({ query: { type: 'string' } }),
    readOnly: true,
    parse: (raw) => stringField(raw, 'query', 200),
    run(query) {
      const found = deps.memos.search(query).slice(0, 20)
      return found.length === 0 ? '찾은 메모 없음' : found.map((m) => `- ${m.body.slice(0, 200)} id=${m.id}`).join('\n')
    }
  }

  const addTask: CommandTool<string> = {
    name: 'add_task',
    description: '할 일을 추가한다. 자연어 빠른 입력 형식(오늘·내일·요일, "3시", #프로젝트, !높음, "매주 월")을 쓸 수 있다.',
    inputSchema: obj({ text: { type: 'string' } }),
    readOnly: false,
    parse: (raw) => stringField(raw, 'text', 500),
    preview(text) {
      const p = parseQuickInput(text, deps.today())
      return {
        title: `할 일 추가: ${p.title}`,
        lines: [p.date ? `날짜: ${p.date}${p.time ? ' ' + p.time : ''}` : '날짜 없음(수신함)', ...(p.project ? [`프로젝트: ${p.project}`] : [])]
      }
    },
    run(text) {
      const p = parseQuickInput(text, deps.today())
      const t = deps.tasks.create({ title: p.title, date: p.date, time: p.time, project: p.project, priority: p.priority, repeat: p.repeat, bucket: p.bucket })
      return `추가됨: ${t.title} id=${t.id}`
    }
  }

  const addMemo: CommandTool<string> = {
    name: 'add_memo',
    description: '메모를 추가한다.',
    inputSchema: obj({ body: { type: 'string' } }),
    readOnly: false,
    parse: (raw) => stringField(raw, 'body', 5000),
    preview: (body) => ({ title: '메모 추가', lines: [body.length > 200 ? body.slice(0, 200) + '…' : body] }),
    run(body) {
      const m = deps.memos.create(body)
      return `메모 추가됨 id=${m.id}`
    }
  }

  const completeTask: CommandTool<string> = {
    name: 'complete_task',
    description: '할 일을 완료로 표시한다. id 는 list_tasks 결과에 있다.',
    inputSchema: obj({ id: { type: 'string' } }),
    readOnly: false,
    parse: (raw) => stringField(raw, 'id', 40),
    preview(id) {
      const t = deps.tasks.get(id)
      return { title: `완료 처리: ${t ? t.title : '(없는 할 일)'}`, lines: t ? [`현재 상태: ${t.status}`] : ['이 id 의 할 일을 찾지 못했습니다.'] }
    },
    run(id) {
      const t = deps.tasks.setStatus(id, 'done')
      return `완료됨: ${t.title}`
    }
  }

  const searchTasks: CommandTool<string> = {
    name: 'search_tasks',
    description: '제목·메모에 글자가 들어 있는 할 일(끝나지 않은 것)을 찾는다. 사용자가 특정 할 일을 말로 가리킬 때 id 를 알아내는 데 쓴다.',
    inputSchema: obj({ text: { type: 'string' } }),
    readOnly: true,
    parse: (raw) => stringField(raw, 'text', 200),
    run(text) {
      const day = deps.today()
      const q = text.toLowerCase()
      const today = deps.tasks.listView('today', day)
      const all = [...today.overdue, ...today.today, ...deps.tasks.listView('inbox', day), ...deps.tasks.listView('upcoming', day), ...deps.tasks.listView('someday', day)]
      const seen = new Set<string>()
      const found = all.filter((t) => !seen.has(t.id) && seen.add(t.id) && (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))).slice(0, 30)
      return found.length === 0 ? '찾은 할 일 없음' : found.map(line).join('\n')
    }
  }

  const FIELD_NAMES = { title: '제목', notes: '메모', date: '날짜', time: '시간', deadline: '마감', priority: '우선순위', project: '프로젝트' } as const
  type PatchKey = keyof typeof FIELD_NAMES
  interface UpdateInput {
    id: string
    patch: Partial<Record<PatchKey, string | number>>
  }
  const updateTask: CommandTool<UpdateInput> = {
    name: 'update_task',
    description: '할 일의 제목·메모·날짜·시간·마감·우선순위(0~3)·프로젝트를 고친다. 바꿀 필드만 값을 주고 나머지는 null. 날짜를 주면 그 날로 예정된다. id 는 list_tasks/search_tasks 결과에 있다.',
    inputSchema: obj({
      id: { type: 'string' },
      title: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'] },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      time: { type: ['string', 'null'], description: 'HH:mm' },
      deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      priority: { type: ['integer', 'null'], description: '0(없음)~3(높음)' },
      project: { type: ['string', 'null'] }
    }),
    readOnly: false,
    parse(raw) {
      const id = stringField(raw, 'id', 40)
      if (!id.ok) return id
      const r = raw as Record<string, unknown>
      const patch: UpdateInput['patch'] = {}
      for (const key of Object.keys(FIELD_NAMES) as PatchKey[]) {
        const v = r[key]
        if (v === null || v === undefined) continue
        if (key === 'priority') {
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 3) return { ok: false, message: 'priority must be an integer 0..3' }
        } else if (typeof v !== 'string' || v.length > 5000) return { ok: false, message: `${key} must be a string` }
        else if ((key === 'date' || key === 'deadline') && !isValidDateString(v)) return { ok: false, message: `${key} must be YYYY-MM-DD` }
        else if (key === 'time' && !isValidTimeString(v)) return { ok: false, message: 'time must be HH:mm' }
        else if (key === 'title' && v.trim() === '') return { ok: false, message: 'title must not be empty' }
        patch[key] = v
      }
      if (Object.keys(patch).length === 0) return { ok: false, message: 'at least one field to change is required' }
      return { ok: true, value: { id: id.value, patch } }
    },
    preview({ id, patch }) {
      const t = deps.tasks.get(id)
      if (!t) return { title: '할 일 고치기: (없는 할 일)', lines: ['이 id 의 할 일을 찾지 못했습니다.'] }
      const show = (v: unknown): string => (v === null || v === '' ? '(없음)' : String(v))
      return {
        title: `할 일 고치기: ${t.title}`,
        lines: (Object.keys(patch) as PatchKey[]).map((k) => `${FIELD_NAMES[k]}: ${show(t[k])} → ${show(patch[k])}`)
      }
    },
    run({ id, patch }) {
      const fields: Parameters<TaskRepository['update']>[1] = { ...patch } as never
      if (patch.date !== undefined) fields.bucket = 'scheduled'
      const t = deps.tasks.update(id, fields)
      return `고침: ${t.title}`
    }
  }

  const listMemos: CommandTool<number> = {
    name: 'list_memos',
    description: '최근 메모를 본다(고정된 메모가 먼저). limit 은 1~50.',
    inputSchema: obj({ limit: { type: 'integer' } }),
    readOnly: true,
    parse(raw) {
      const v = isRecord(raw) ? raw.limit : undefined
      return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 50 ? { ok: true, value: v } : { ok: false, message: 'limit must be an integer 1..50' }
    },
    run(limit) {
      const memos = deps.memos.list().slice(0, limit)
      return memos.length === 0 ? '메모 없음' : memos.map((m) => `- ${m.pinned ? '(고정) ' : ''}${m.body.slice(0, 200)} id=${m.id}`).join('\n')
    }
  }

  const listRoutinesToday: CommandTool<null> = {
    name: 'list_routines_today',
    description: '오늘의 데일리 체크리스트(루틴 항목)와 완료 여부를 본다.',
    inputSchema: obj({}),
    readOnly: true,
    parse: () => ({ ok: true, value: null }),
    run() {
      const items = deps.routines.todayItems(deps.today())
      return items.length === 0 ? '오늘 루틴 없음' : items.map(line).join('\n')
    }
  }

  return [listTasks, searchTasks, listMemos, listRoutinesToday, searchMemos, addTask, updateTask, addMemo, completeTask] as CommandTool[]
}

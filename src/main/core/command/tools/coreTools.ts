import type { Task, TaskView } from '../../../../shared/tasks/types'
import { parseQuickInput } from '../../../../shared/tasks/quickParse'
import type { MemoRepository } from '../../memos/memoRepository'
import type { TaskRepository } from '../../tasks/taskRepository'
import { isRecord, stringField, type CommandTool } from './registry'

export interface CoreToolDeps {
  tasks: TaskRepository
  memos: MemoRepository
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

  return [listTasks, searchMemos, addTask, addMemo, completeTask] as CommandTool[]
}

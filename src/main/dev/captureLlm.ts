import type { KeyStore } from '../core/command/adapterResolver'
import type { ChatResponse, LlmAdapter } from '../core/command/llm/types'
import type { CommandSession } from '../core/command/session'
import type { InitialView } from '../../shared/initialView'
import type { LlmProvider } from '../../shared/command/types'

// 개발용 화면 캡처에서만 쓰는 가짜 모델과 가짜 키 보관. 캡처 모드(OCTOPUS_CAPTURE, 배포 앱 아님)가 아니면 import 되어도 쓰이지 않는다.
// 진짜 키·네트워크·보안 저장소는 건드리지 않는다.

/** 캡처 화면마다 키가 저장돼 있는지: 지시하기·설정 화면은 "저장됨", 나머지는 없음. 값은 화면 어디에도 나오지 않는다. */
export function createCaptureKeyStore(view: InitialView): KeyStore {
  const data: Partial<Record<LlmProvider, string>> = view === 'command' || view === 'settings' ? { anthropic: 'capture-fake-key' } : {}
  return { get: (p) => data[p], set: (p, k) => void (data[p] = k), delete: (p) => void delete data[p] }
}

const reply = (content: ChatResponse['content'], stopReason: ChatResponse['stopReason']): ChatResponse => ({
  content,
  stopReason,
  usage: { inputTokens: 0, outputTokens: 0 }
})

/** 정해진 응답을 차례로 돌려주는 가짜 모델. 다 쓰면 짧은 안내만 한다. */
export function createCaptureAdapter(): LlmAdapter {
  const steps: ChatResponse[] = [
    reply([{ type: 'tool_use', id: 'cap_1', name: 'list_tasks', input: { view: 'today' } }], 'tool_use'),
    reply(
      [{ type: 'text', text: '오늘 할 일은 4개예요.\n- 주간 보고서 작성 (15:00)\n- 장보기: 우유, 달걀\n- 운동 30분 (19:30)\n- 영어 단어 20개 외우기\n지난 할 일도 2개 남아 있어요.' }],
      'end_turn'
    ),
    reply(
      [
        { type: 'text', text: '치과 예약 전화를 내일 오후 3시 할 일로 추가할게요. 아래 내용을 확인하고 실행을 눌러 주세요.' },
        { type: 'tool_use', id: 'cap_2', name: 'add_task', input: { text: '내일 오후 3시 치과 예약 전화' } }
      ],
      'tool_use'
    )
  ]
  let next = 0
  return {
    async chat() {
      return next < steps.length ? steps[next++] : reply([{ type: 'text', text: '(캡처용 가짜 응답입니다.)' }], 'end_turn')
    }
  }
}

/** 대화 2턴을 만들고 두 번째 턴에서 "할 일 추가" 승인 카드가 떠 있는 상태로 둔다. */
export async function seedCaptureCommand(session: CommandSession, modelId: string): Promise<void> {
  const first = await session.send({ conversationId: null, modelId, text: '오늘 할 일 알려줘' })
  await session.send({ conversationId: first.conversationId, modelId, text: '내일 오후 3시에 치과 예약 전화하는 걸 할 일로 추가해줘' })
}

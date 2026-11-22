import type { IpcResult } from '../ipc'
import type { Memo, MemoToTaskResult } from './types'

/** preload 가 window.octopus.memos 로 노출하는 API. 모든 호출은 예외 대신 결과 객체를 돌려준다. */
export interface MemosApi {
  /** 고정한 메모 먼저, 수정 시각 최신순 */
  list(): Promise<IpcResult<Memo[]>>
  create(body: string): Promise<IpcResult<Memo>>
  update(id: string, body: string): Promise<IpcResult<Memo>>
  remove(id: string): Promise<IpcResult<null>>
  togglePin(id: string): Promise<IpcResult<Memo>>
  /** 본문 부분 일치 검색 */
  search(query: string): Promise<IpcResult<Memo[]>>
  /** 첫 줄을 제목으로 할 일을 만들고 메모에 연결한다. */
  toTask(id: string): Promise<IpcResult<MemoToTaskResult>>
}

// CLAUDE.md 4.2 의 Memo. 본문은 마크다운 원문 그대로 저장한다.
export interface Memo {
  id: string
  body: string
  pinned: boolean
  taskId: string | null
  createdAt: string
  updatedAt: string
}

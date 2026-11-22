/** 없는 항목을 찾았을 때의 공통 부모. IPC 핸들러는 이 클래스 하나만 보고 not_found 로 바꾼다. */
export class EntityNotFoundError extends Error {
  readonly id: string

  constructor(kind: string, id: string) {
    super(`${kind} not found: ${id}`)
    this.name = 'EntityNotFoundError'
    this.id = id
  }
}

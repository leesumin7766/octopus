export interface ValidationIssue {
  field: string
  message: string
}

/**
 * 필드 검증 실패의 공통 부모. IPC 핸들러는 이 클래스 하나만 보고 invalid_input 으로 바꾼다.
 * 메시지에는 입력값을 넣지 않는다. 화면 문구는 호출하는 쪽에서 field 로 고른다.
 */
export class FieldValidationError extends Error {
  readonly issues: readonly ValidationIssue[]

  constructor(label: string, issues: readonly ValidationIssue[]) {
    super(`invalid ${label}: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`)
    this.name = 'FieldValidationError'
    this.issues = issues
  }
}

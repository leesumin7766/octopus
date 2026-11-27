# P5 검증 결과 — 수정 필요

2026-11-27 / Codex / dev HEAD `2f8f168` 이후 미커밋 메모 저장 변경.

## 검증 범위

현재 VS Code의 열린 Claude 대화에는 이전 C2 보고가 표시되어 최신 Haiku 최종 보고 원문을 확인하지 못했다. 현재 변경된 제품 코드와 `stage1-work-orders.md`의 P5 끝 기준을 대조했다.
제품 코드는 수정하지 않았다. 검증 중 별도의 `tests/verify/P5.test.ts`와 실행 로그가 생성된 것을 발견했으며 해당 파일은 수정하지 않았다.

## 결과

- 독립 테스트 추가 전: `npm run typecheck` 및 전체 `npm test` 통과. 118개 파일·1,767개 테스트.
- 개발 테스트(`memoSaveGuard`, `leftoverAfterSave`): 14개 통과.
- Codex 독립 보존 테스트: 최초 실행 2개 모두 실패. 파일은 node 타입 검사와 호환되도록 JSX 없이 `tests/verify/P5-preservation.test.ts`로 정리했다.
- 이후 타입 검사에는 별도로 생성된 `tests/verify/P5.test.ts`의 ByRoleOptions에 없는 exact 옵션 2곳에서 오류가 발생했다. 제품 코드 오류와 구분해야 한다.

## 재현한 결함

지시서는 '보낸 글과 현재 글이 같을 때만 비움, 달라지면 입력 보존'을 요구한다. 현재 helper는 접두부를 제거하고 trimStart까지 한다.

1. 홈 입력 '회의 메모' 저장을 지연 → '회의 메모  이어 쓰는 내용'으로 변경 → 저장 완료: 전체가 남아야 하나 '이어 쓰는 내용'만 남음.
2. 대화상자 '첫 문단' 저장을 지연 → '첫 문단\n\n  다음 문단'으로 변경 → 저장 완료: '다음 문단'만 남음. 문단과 들여쓰기도 제거됨.

원인: `src/renderer/memos/leftoverAfterSave.ts`의 startsWith 분기. 개발 테스트가 이 지시서 외 동작을 기대하고 있어 통과한다.
요구대로 전체 현재 입력을 보존하도록 수정하고, 개발 테스트도 승인된 요구에 맞춰야 한다. 검증 테스트의 기대를 낮추지 않는다.

## 추가 코드 검토 사항

- 새 저장 코드들은 try/finally만 사용해 IPC Promise 예외를 사용자 오류로 바꾸지 못한다. preload의 create는 ipcRenderer.invoke를 직접 반환하므로 거부 가능성이 있다. safeInvoke 등 기존 방식으로 오류를 보여 주고 초안 유지·가드 해제·재시도를 검증해야 한다.
- 일반 ok:false 응답 테스트 통과는 Promise 예외 처리 검증을 대신하지 않는다.
- 실제 Electron 입력 검증은 이번에 수행하지 않았다.

판정: **P5 통과 불가. 수정 후 재검증 필요.** P4 커밋은 이번 P5 독립 검증의 승인 대상이 아니다.

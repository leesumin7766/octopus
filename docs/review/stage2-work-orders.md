# 2단계 작업 지시서 — 추가·끝내기 흐름

근거: [usability-proposal.md](usability-proposal.md) 2.2·3.3·4장 2단계. 작성 2026-11-28 / Claude Code (Opus).
공통 규칙(개발자·검증자)은 [stage1-work-orders.md](stage1-work-orders.md) 의 "모든 항목 공통 규칙"과 같다. 다시 적지 않는다.

권장 순서: **F5 → F1 → F3 → F4 → F2** (작은 것부터, 같은 파일을 동시에 고치지 않게)

---

## F5 상세 패널에서 '보관함' 칸 빼기

- **파일:** `src/renderer/tasks/DetailPanel.tsx` (+ `ko.ts` 문구)
- **지금:** 상세 패널에 '보관함'(수신함/예정/나중에) 선택 칸이 있다. 날짜와 맞지 않는 조합이면 저장할 때 오류가 난다.
- **할 일 (3.3-12):**
  1. '보관함' 선택 칸과 `repeatLocksBucket` 안내를 없앤다.
  2. 저장할 때 bucket 은 저절로 정한다: 날짜가 있으면 `scheduled`, 없으면 `inbox`. 반복이 있으면 `scheduled`.
  3. 지금 '나중에'(someday)인 할 일은 날짜를 넣지 않는 한 `someday` 를 유지한다(편집만 했다고 수신함으로 옮기지 않는다).
  4. **[나중에로]** 버튼을 둔다. 누르면 날짜·시각을 비우고 `someday` 로 저장한다(기존 `moveToSomeday` 사용 가능). 반복 할 일에서는 숨긴다. 이미 '나중에'면 숨긴다.
  5. '나중에' 할 일에 날짜를 넣으면 `scheduled` 가 된다.
- **끝 기준:** 날짜를 지우고 저장 → 오류 없이 수신함. 날짜를 넣고 저장 → 예정. [나중에로] → 나중에 보기로. 나중에 할 일의 제목만 고쳐 저장 → 나중에 그대로. bucket 오류 문구가 화면에 나오는 경로가 없다.

## F1 날짜 상세·달력 탭에서도 자연어 입력

- **파일:** `src/shared/tasks/quickParse.ts`, `src/main/ipc/tasks.ts`, `src/shared/tasks/ipcApi.ts`, `src/shared/validation/taskIpc.ts`(입력 검사), `src/preload/index.ts`, `src/renderer/tasks/QuickInput.tsx`, `src/renderer/home/calendar/DayDialog.tsx`(`AddForm`)
- **지금:** 날짜 상세(홈 달력 카드·달력 탭이 같은 `DayDialog` 를 쓴다)의 추가 칸은 `tasks.create` 로 글을 그대로 제목에 넣는다. "내일 3시 회의"가 제목이 된다.
- **할 일 (3.3-4, 3.4):**
  1. `parseQuickInput(text, today, options?)` 에 `options.defaultDate` 를 더한다. 문장에 날짜가 없으면 `defaultDate` 를 쓴다(시각만 있을 때도, 반복의 첫 회차 계산 기준도 `defaultDate`). 문장에 날짜가 있으면 문장이 이긴다. 결과에 `dateFrom: 'text' | 'default' | null` 을 더해 미리보기가 어느 쪽인지 보일 수 있게 한다. `options` 가 없으면 지금과 결과가 같아야 한다(기존 테스트 그대로 통과).
  2. `tasks.quickAdd(text, options?)`·`tasks.parsePreview(text, options?)` 가 `{ defaultDate?: 'YYYY-MM-DD', defaultTime?: 'HH:MM' }` 을 받는다. main 에서 형식을 검사하고, 틀리면 `invalid_input`. `defaultTime` 은 문장에 시각이 없을 때만 쓴다.
  3. `QuickInput` 에 선택 옵션 `defaultDate`·`showTimeField` 를 더한다. 시각 칸은 `showTimeField` 일 때만 보이고 `defaultTime` 으로 넘긴다. 미리보기 날짜 칩은 `dateFrom` 이 `default` 면 "이 날짜", `text` 면 문장 날짜를 보이고, 상세의 날짜와 다르면 그 사실이 드러나게 한다(예: "날짜 11월 29일(문장)").
  4. `DayDialog` 의 `AddForm` 을 `QuickInput`(defaultDate=그 날, showTimeField) 으로 바꾼다. 지금 동작은 유지한다: 쓰던 글이 있으면 떠나기 보호(`onDirtyChange`/`draftRef` 와 날짜 이동 확인), 추가 뒤 목록 다시 읽기, 실패하면 입력 유지.
- **끝 기준:** 11월 30일 상세에서 "3시 회의" → 11월 30일 15:00 '회의'. "내일 회의" → 미리보기에 내일 날짜(문장)로 보이고 내일로 저장. 시각 칸 10:00 + "회의" → 10:00. 시각 칸 10:00 + "3시 회의" → 15:00(문장이 이김). 쓰는 중 날짜 이동 → 먼저 묻는다(지금처럼). 할 일 탭·홈 입력은 결과가 바뀌지 않는다.

## F3 추가 결과 안내 + [보기]

- **파일:** 새 `src/shared/tasks/viewOf.ts`(순수 함수), `src/renderer/App.tsx`, `src/renderer/home/HomeScreen.tsx`, `src/renderer/home/cards/TodoCard.tsx`, `src/renderer/tasks/TasksScreen.tsx`, 새 공용 알림 부품(예: `src/renderer/ui/ActionNotice.tsx`)
- **지금:** 홈에서 "보고서"(수신함)나 "내일 보고서"를 넣으면 오늘 카드에 안 보이고 안내도 없다. 할 일 탭 '오늘' 보기에서 "다음 주 월 회의"를 넣어도 마찬가지다.
- **할 일 (3.3-5):**
  1. `viewOf(task, today): TaskView` — 그 할 일이 보이는 보기. done/canceled → `done`, someday → `someday`, 날짜 없음 → `inbox`, 날짜 ≤ 오늘 → `today`(지난 할 일 포함), 그 뒤 → `upcoming`. 단위 테스트.
  2. 할 일 하나를 찾아 여는 길: `App` 에 `openTask(task)` 를 둔다. 떠나기 보호를 지나(`navigate` 와 같은 확인) 할 일 화면으로 가서 `viewOf` 보기를 열고 그 할 일을 선택(상세 패널 열림)한다. `TasksScreen` 은 `focus?: { taskId, view, nonce }` 같은 prop 을 받아 처리한다. 이미 할 일 화면이면 보기만 바꾸고 선택한다(상세 패널에 쓰던 내용이 있으면 P1 규칙대로 먼저 묻는다).
  3. 홈 '오늘 할 일' 카드: 추가한 할 일이 오늘 목록에 없으면 알림 "수신함에 추가했어요 [보기]", "11월 29일에 추가했어요 [보기]"(날짜는 기존 `formatDate` 로, 내일이면 '내일'). [보기] → `openTask`.
  4. 할 일 탭: 지금 보기에 안 나오는 곳으로 추가되면 같은 알림. [보기] → 그 보기로 바꾸고 선택.
  5. 알림 모양은 기존 되돌리기 알림과 같은 부품으로 만든다(F2 에서 되돌리기 알림도 이 부품을 쓴다). 6초 뒤 사라지고 `role="status"`.
- **끝 기준:** 홈에서 "보고서" → 안내 → [보기] 한 번에 수신함 보기에서 그 할 일 선택. "내일 보고서" → 예정 보기에서 선택. "보고서 오늘"·"3시 보고서" → 오늘 카드에 보이고 안내 없음. 할 일 탭 '오늘'에서 "다음 주 월 회의" → 안내 → [보기]. 홈 입력칸에 다른 글을 쓰는 중 [보기] → 먼저 묻는다.

## F4 홈에서 눌러서 이어 가기

- **파일:** `src/renderer/home/cards/TodoCard.tsx`, `src/renderer/home/cards/MemoCard.tsx`, `src/renderer/home/HomeScreen.tsx`, `src/renderer/App.tsx`, `src/renderer/memos/MemosScreen.tsx`
- **지금:** 홈 할 일 제목·메모 첫 줄은 눌러도 아무 일이 없다. 메모 화면에서 '할 일로 만들기' 뒤에 만든 할 일로 가는 길이 없다.
- **할 일:**
  1. 홈 '오늘 할 일' 제목을 누르면(버튼, 키보드로도) F3 의 `openTask` 로 상세가 열린다. 체크리스트 항목(`routineId` 있음)도 같은 할 일이라 같게 연다.
  2. 홈 메모 카드의 메모 줄을 누르면 메모 화면으로 가서 그 메모가 보이게(스크롤·강조) 하고 편집을 시작한다. `App` 에 `openMemo(id)` 를 F3 처럼 둔다.
  3. 메모 화면 '할 일로 만들기' 성공 뒤 알림 "할 일로 만들었어요 [보기]" → `openTask`. (`toTask` 결과에 만든 할 일이 있는지 확인. 없으면 계약을 바꾸지 말고 보고한다.)
- **끝 기준:** 홈 할 일 제목 클릭 → 상세 패널 1번에. 홈 메모 클릭 → 그 메모 편집 상태. 메모 → 할 일로 만들기 → [보기] → 그 할 일. 모두 쓰던 내용이 있으면 먼저 묻는다.

## F2 체크와 복구를 어디서나 같게

- **파일:** `src/renderer/tasks/TasksScreen.tsx`·`TaskRow.tsx`·`OverdueSection.tsx`, `src/renderer/home/cards/TodoCard.tsx`, `src/renderer/home/calendar/DayDialog.tsx`(`LocalTasks`), `src/renderer/routines/RoutinesScreen.tsx`, F3 의 알림 부품, 새 공용 훅(예: `src/renderer/tasks/useCompleteWithUndo.ts`)
- **지금:** 체크 동작이 4가지다(제안서 2.2 표). 홈만 되돌리기가 1단계에서 생겼고, 날짜 상세·체크리스트에는 알림이 없다.
- **할 일 (3.3-6):**
  1. 공용 훅으로 모은다: 체크 → 바로 줄 긋기(저장은 done) → 되돌리기 알림(같은 부품, 6초) → [되돌리기] 는 open 으로. 연타해도 요청 한 번. 저장 실패면 줄 긋기를 풀고 오류를 보인다.
  2. 줄이 어디로 가는지는 화면마다 그대로 둔다: 할 일 탭·홈은 흐려진 뒤 사라짐, 날짜 상세·달력 탭·체크리스트는 줄 긋고 남음(다시 누르면 해제도 유지).
  3. 할 일 탭에서 '안 하기'의 되돌리기 알림도 같은 부품을 쓴다(문구만 다름).
  4. 체크리스트 화면의 `slate-*` 색은 이 항목에서 건드리지 않는다(3단계 N5).
- **끝 기준:** 네 화면(할 일 탭·홈·날짜 상세·체크리스트) 각각: 체크 → 줄 그어짐 → 같은 모양 알림 → [되돌리기] → 미완료로 돌아옴. 저장 실패 → 체크가 풀리고 오류. 느린 저장 중 연타 → 요청 1번. 화면별 테스트.

---

## 끝나면

- 항목마다 Opus 가 `tests/verify/F*-opus.test.ts(x)` 로 검증하고 통과하면 커밋한다.
- 2단계 결과와 남은 사항은 제안서 4장에 "2단계 결과"로 적는다.
- push 는 사용자 승인 후다.

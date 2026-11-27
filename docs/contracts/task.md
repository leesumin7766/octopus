# 할 일(Task) 데이터 계약

코드 기준: `src/shared/tasks/types.ts`. 이 문서는 필드의 뜻과 규칙을 적어 둔다. 모양을 바꾸면 이 문서와 테스트를 함께 고친다.
모든 할 일·메모의 원본은 Octopus 로컬 DB 하나다(CLAUDE.md 1장). 오늘·예정·나중·수신함은 같은 `Task` 를 거른 "보기"이다.

## Task

| 필드 | 형 | 뜻 |
|---|---|---|
| `id` | string (ULID) | |
| `title` | string | 비어 있을 수 없다 |
| `notes` | string | 마크다운, 빈 문자열 가능 |
| `status` | `'open' \| 'done' \| 'canceled'` | `canceled` = 화면 이름 '안 하기로 함'. 열린·끝난 보기와 달력·완료 수에는 나오지 않고 지워지지도 않는다. 완료 보기의 '안 하기로 함'(별도 조회 `tasks:listCanceled`)에서만 보이고, 거기서 다시 열면 `open` |
| `bucket` | `'inbox' \| 'scheduled' \| 'someday'` | 날짜 없음 / 날짜 있음 / 언젠가 |
| `date` | `YYYY-MM-DD \| null` | 할 날. `bucket === 'scheduled'` 일 때만 있고, 그때는 반드시 있다 |
| `time` | `HH:mm \| null` | |
| `deadline` | `YYYY-MM-DD \| null` | 마감일(할 날과 다름) |
| `priority` | 0~3 | |
| `project` | string \| null | |
| `tags` | string[] | 빈 문자열 불가 |
| `repeat` | `RepeatRule \| null` | 아래 참고. 있으면 `bucket` 은 `scheduled`(날짜 필요) |
| `routineId` | string \| null | 데일리 체크리스트에서 생긴 항목(그날 날짜에 묶여 `scheduled`) |
| `source` | `{ arm, ref, url? } \| null` | Arm 에서 온 경우 원본 위치 |
| `order` | number | |
| `createdAt` `updatedAt` `doneAt` | ISO 시각 | `doneAt` 은 완료한 시각 |

저장은 SQLite. `repeat` 와 `tags` 는 JSON 문자열이라 필드를 더해도 마이그레이션이 필요 없지만, **저장돼 있는 옛 JSON 을 그대로 읽을 수 있어야 한다.**

## RepeatRule (RRULE 부분집합)

```ts
interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number        // 1 이상의 정수
  byWeekday?: number[]    // 0=일 .. 6=토, 비어 있지 않아야 함
  byMonthDay?: number     // 1~31
  byMonth?: number        // 1~12 (yearly 에만, byMonthDay 와 함께)
  anchor?: string         // YYYY-MM-DD, 반복을 시작한 기준일
}
```

### 다음 회차 계산 (`src/shared/tasks/repeat.ts`)

반복하는 할 일을 끝내면 다음 회차가 새 할 일로 만들어진다. 규칙(`repeat`)은 다음 회차에 **그대로 복사**된다(`anchor`·`byMonth` 포함).
끝낸 회차의 날짜보다 뒤이면서 오늘 이상인 첫 회차를 고른다(오래 밀린 반복을 끝내도 지난 날짜로 만들지 않는다).

- **daily**: `interval` 일마다.
- **weekly**: `byWeekday` 의 요일들. 주의 시작은 월요일이고, 없으면 기준 날짜와 같은 요일. 그 주에 남은 요일이 없으면 `interval` 주 뒤.
- **monthly**: `byMonthDay` 일(없으면 기준 날짜의 일). 그 달에 없는 날(31일 등)은 그 달의 마지막 날로 밀리고, 다음 달에는 다시 원래 일.
- **yearly**:
  - `byMonth` + `byMonthDay` 가 있으면 **매년 그 월·일**. 2/29 는 평년에 2/28, 윤년에는 다시 2/29(2028-02-29 → 2029-02-28 → 2030-02-28 → 2031-02-28 → 2032-02-29).
  - 없으면(옛 규칙) 직전 회차와 같은 월·일. 한 번 2/28 로 밀리면 2/29 로 돌아오지 못한다.

### 기준일 (`anchor`)

- `interval` 이 1 보다 클 때(격주·격월·2년마다·n일마다)만 계산이 달라진다. 주기를 **직전 회차가 아니라 기준일에서부터** 센다.
  그래서 늦게 끝내거나 사용자가 할 날짜를 옮겨도 격주가 어긋나지 않는다.
  - 격주 월요일(기준일 3/2): 3/10 으로 옮겨 끝내면 다음은 3/16(기준일 주기), 기준일이 없으면 3/23.
  - 기준일보다 앞선 날짜는 회차가 아니다.
  - 주는 기준일이 있는 주(월요일 시작)를 0번째로 센다. 달·해도 기준일의 달·해를 0번째로 센다.
- `anchor` 가 **없는 옛 데이터는 예전 동작 그대로**(직전 회차에서 센다). 저장돼 있는 규칙을 일부러 바꾸지 않는다.
- `interval` 이 1 이면 `anchor` 는 계산에 영향이 없다.

### 새 반복을 만들 때

빠른 입력 파서와 상세 패널의 반복 편집기는 새 반복(또는 모양을 바꾼 반복)에 다음을 채운다.
루틴 항목은 반복 규칙이 없으므로 해당하지 않는다.

- `anchor` = 그 할 일의 `date`
- yearly 면 `byMonth`·`byMonthDay` = 그 `date` 의 월·일(이미 있는 값은 그대로)
- 규칙의 모양(종류·간격·요일·매월의 날)을 바꾸지 않고 저장하면 저장돼 있던 규칙(기준일 포함)을 그대로 둔다.

### 검증 (`repeatRuleProblem`)

- `freq` 는 네 가지 중 하나, `interval` 은 양의 정수.
- `byWeekday` 는 0~6 정수의 비어 있지 않은 배열, `byMonthDay` 는 1~31 정수.
- `byMonth` 는 1~12 정수이고 `yearly` 에만 쓸 수 있으며 `byMonthDay` 가 함께 있어야 한다.
- `anchor` 는 실제로 있는 날짜(`2026-02-30` 불가).
- 월 없이 `byMonthDay` 만 있는 옛 yearly 규칙은 받아들인다(읽기 호환).

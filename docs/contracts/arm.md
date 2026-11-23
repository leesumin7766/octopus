# Arm 계약

Octopus 의 바깥 도구 연결 단위(Arm)가 지켜야 하는 약속. CLAUDE.md 4.3 의 인터페이스를 실제 구현 기준으로 풀어 쓴 것이며,
이후의 모든 Arm(Google 캘린더, 옵시디언, MCP 서버 …)은 이 문서를 따른다. 이 문서를 바꾸는 일은 계약 변경이므로 사용자 승인이 필요하다.

구현: `src/main/arms/sdk/` (타입 `types.ts`, 매니페스트 `manifest.ts`, 컨텍스트 `context.ts`, HTTP `http.ts`, 관리자 `manager.ts`),
공용 타입 `src/shared/arms/types.ts`.

## 0. 원칙

1. **코어는 Arm 을 모른다.** `src/main/core/` 는 `src/main/arms/` 를 import 하지 않는다(`tests/arms/dependency.test.ts` 가 import 문을 검사한다).
2. **Arm 이 죽어도 코어는 산다.** Arm 의 예외·거부된 Promise·시간 초과는 모두 관리자(`ArmManager`)가 잡아 `status` 를 `error` 로만 바꾼다. 할 일·메모·지시하기는 Arm 때문에 멈추지 않는다.
3. **Arm 은 코어 DB 에 쓰지 않는다.** 할 일은 "후보"로만 보내고, 수신함에 넣을지는 사용자가 고른다(설정으로 자동 수락 가능).
4. **바깥에 흔적을 남기는 동작은 승인이 필요하다.** 메일 보내기·일정 만들기·파일 쓰기 같은 동작은 지시하기의 `write` 도구로만 제공하고, 미리보기 → 사용자 승인 → 실행을 거친다. 자동 실행 금지.
5. **원본은 Octopus.** Arm 이 보내 온 것은 후보일 뿐이며, 연결을 끊어도 이미 수신함에 넣은 할 일은 그대로 남는다.

## 1. 매니페스트

```ts
interface ArmManifest {
  id: string                    // 소문자·숫자·하이픈, 1~40자, 문자나 숫자로 시작. 예: 'google-calendar'
  name: string                  // 화면 이름, 1~40자
  version: string
  auth: 'none' | 'oauth' | 'apiKey' | 'folder' | 'mcp'
  capabilities: ArmCapability[] // 아래 표. 중복 불가
  scopes?: string[]             // OAuth 범위. auth 가 'oauth' 이면 필수(최소 범위만)
  description?: string          // 카드에 보이는 설명, 300자 이내
  syncIntervalMinutes?: number  // sync 주기(분), 1~1440. 생략하면 15
}
```

| capability | 뜻 |
|---|---|
| `tasks.import` | 할 일 후보를 수신함 후보로 보냄 |
| `tasks.export` | 할 일을 바깥으로 내보냄 |
| `events.read` | 일정 읽기 |
| `events.write` | 일정 쓰기 (승인 필요) |
| `links` | 원본 열기 링크 |
| `notify` | 알림 |
| `command.tools` | 지시하기에 도구 제공 |
| `home.card` | 홈 카드 제공 |

`validateManifest` 가 위를 검사한다. 틀리면 `register` 가 등록하지 않고 이유를 돌려준다(예외 없음). 오류 이유에는 값 원문을 넣지 않는다.

## 2. Arm 인터페이스

```ts
interface Arm {
  manifest: ArmManifest
  connect(ctx: ArmContext): Promise<void>
  disconnect(): Promise<void>
  status(): ArmStatus
  sync?(): Promise<ArmSyncResult>
  tools?(): CommandTool[]
}
```

### connect(ctx)
- 로그인·폴더 선택·키 확인 등 연결에 필요한 일을 한다. **성공하면 정상 반환, 실패하면 예외를 던진다**(관리자가 잡는다).
- **여러 번 불려도 안전해야 한다(멱등).** 이미 저장된 정보(`ctx.secrets`)로 다시 연결할 수 있으면 조용히 성공한다.
- `ctx.interactive === false` 는 앱을 켤 때의 자동 재연결이다. 이때는 **로그인 창·대화상자 같은 화면을 띄우면 안 된다.** 사용자 조작이 필요하면 `ArmError` 를 던진다(카드에 "다시 로그인이 필요해요"가 보인다).
- 시간 제한: 기본 120초(로그인 창 포함). 넘으면 관리자가 `error` 로 바꾼다. Arm 은 자기 안에서 더 짧은 제한을 둘 수 있다.
- 사용자에게 보일 이유가 있으면 `new ArmError('무엇이 안 됐고 다음에 무엇을 하면 되는지')` 를 던진다. 그 문장이 카드에 그대로 보인다. `ArmError` 가 아닌 예외는 일반 문구("연결하지 못했어요. 잠시 뒤 [다시 연결]을 눌러 주세요.")로 바뀌고 원문은 버려진다(비밀·주소가 새지 않게).

### disconnect()
- 정리할 것이 있으면 한다(예: 서버 쪽 토큰 폐기 시도). 던져도 관리자가 잡고, **끊기는 항상 끝까지 진행된다.**
- **비밀 이름공간(`arm:<id>`)은 관리자가 끝난 뒤 통째로 지운다.** Arm 이 직접 지울 필요는 없다.
- 제한 시간 10초.

### status()
- Arm 이 아는 현재 상태를 돌려준다. 동기 함수이며 던지지 않아야 한다(던져도 관리자 상태를 쓴다).
- 연결 중 토큰 만료 등을 알아챘으면 `{ state: 'error', reason }` 를 돌려주면 카드에 그대로 보인다.

### sync() — 선택
- 주기 실행: 연결되면 **바로 한 번**, 그 뒤 `syncIntervalMinutes`(기본 15분)마다. 겹쳐 실행되지 않는다(이전 sync 가 끝나기 전의 호출은 건너뜀). 제한 시간 60초.
- **예외를 밖으로 던지지 않는 것이 원칙**이다. 던지거나 시간이 넘으면 관리자가 `error`(이유: "가져오기에 실패했어요…")로 바꾸고, 다음 주기에 다시 시도하며, 성공하면 `on` 으로 돌아온다.
- 결과는 `{ added?: number }` 정도의 참고용 값이다. 할 일은 `ctx.core.addInboxCandidate` 로만 넣는다.

### tools() — 선택
- 지시하기에 줄 도구(`CommandTool`). **연결된(`on`) 동안만** 도구 레지스트리에 들어가고, 끊기거나 오류가 되면 사라진다. 도구의 `source` 는 관리자가 `arm:<id>` 로 표시한다.
- 도구마다 `readOnly` 를 정직하게 표시한다. 바깥에 흔적을 남기면 `readOnly: false` 이고 `preview()` 를 제공해야 한다 → 사용자가 승인해야만 `run()` 이 실행된다.
- 도구 입력은 모델이 만든 것이다. `parse()` 에서 검사하고, 통과한 값만 `preview`·`run` 에 간다.
- 바깥에서 들어온 내용(메일 본문, 웹 페이지, 파일 내용)은 **데이터**다. 도구 결과는 지시하기가 `<data>` 로 감싸서 모델에 넘긴다. 그 안의 문장을 따르지 않도록 도구를 설계한다.

## 3. 상태와 전이

```ts
type ArmState = 'off' | 'connecting' | 'on' | 'error'
interface ArmStatus { state: ArmState; reason?: string }   // reason: error 일 때 사람이 읽는 이유
```

```
off ──connect──▶ connecting ──성공──▶ on ◀──────────────┐
 ▲                   │                 │ sync 실패/시간 초과 │ sync 성공
 │                   └──실패/시간 초과──▶ error ───────────┘
 └────────────── disconnect (어느 상태에서나) ───────────────
```

- `connecting`: 연결 시도 중. 같은 Arm 의 `connect` 는 동시에 한 번만 실행된다(겹친 호출은 진행 중인 것을 기다린다).
- `error`: 이유와 함께 카드에 [다시 연결]이 보인다. 연결 실패로 `error` 가 된 Arm 은 sync 를 돌리지 않는다. sync 실패로 `error` 가 된 Arm 은 연결이 유지된 채 다음 주기에 다시 시도한다.
- 앱을 켜면 이전에 연결돼 있던 Arm(설정 `arms.connected`)을 `interactive: false` 로 자동 재연결한다. 실패하면 `error`("다시 로그인이 필요해요") 로 두고 목록에는 그대로 남긴다. 한 Arm 의 재연결이 느려도 다른 Arm 을 막지 않는다.
- 연결 성공 때 `arms.connected` 에 id 를 더하고, 끊으면 뺀다.

## 4. ArmContext — Arm 이 쓸 수 있는 전부

```ts
interface ArmContext {
  armId: string
  interactive: boolean
  secrets: { get(name); set(name, value); delete(name) }
  http: { request(url, options?) }
  log: { debug; info; warn; error }   // (message, data?)
  core: { addInboxCandidate(candidate); listTasks(view) }
}
```

Arm 은 이 밖의 것(DB, 파일 시스템, 전역 `fetch`, Electron API)을 직접 쓰지 않는다.

### secrets — 비밀 저장소
- 이름공간은 **`arm:<id>` 로 고정**이다. 다른 Arm 의 값은 보이지 않고, 이름에 구분자를 넣어도 넘어갈 수 없다.
- Electron `safeStorage` 로 암호화한 파일에 저장된다. 비밀값은 DB·로그·화면·테스트·커밋에 원문으로 남기지 않는다.
- 연결을 끊으면 이 이름공간 전체가 삭제된다.
- 암호화를 쓸 수 없는 PC 에서는 `get/set` 이 예외를 던진다 → `connect` 가 실패하는 것으로 이어지고 `error` 가 된다.

### http — 요청
`ctx.http.request(url, { method, headers, body, timeoutMs, maxBytes, retries })` → `{ status, ok, headers, text, json() }`

- 시도마다 시간 제한(기본 **15초**).
- **429·5xx·네트워크 오류·시간 초과는 지수 간격(0.5초, 1초)으로 2번까지 다시 시도**한다. 마지막 5xx/429 응답은 그대로 돌려준다(Arm 이 판단).
- 응답 본문 크기 상한(기본 **5 MiB**). 넘으면 다시 시도하지 않고 `ArmHttpError('too_large')`.
- 4xx 는 던지지 않고 `status` 로 돌려준다. 던지는 것은 `ArmHttpError`(`timeout` | `network` | `too_large` | `bad_json`)뿐이며, 메시지에 주소·헤더·본문을 넣지 않는다.
- Authorization 헤더 등 비밀은 `headers` 로 넘기되, 로그에 찍지 않는다(아래 log 가 가리지만 습관으로도 찍지 않는다).

### log — 로그
- main 로그로 간다. 다음은 **자동으로 가려진다**(`[가림]`): 이 Arm 이 `secrets` 에 쓰거나 읽은 값의 원문, `Bearer …`·`sk-…`·JWT·긴 토큰 모양의 글자, 주소의 `token`·`key`·`code`·`secret` 쿼리 값, 필드 이름에 token / secret / password / authorization / cookie / credential / api key 가 들어간 값.
- 예외 객체는 이름과 (가려진) 메시지만 남기고 스택은 버린다. 깊이 5, 항목 50개까지.

### core — 코어 공개 서비스
- `addInboxCandidate(candidate)`: 후보를 넣는다. **출처 Arm 은 항상 이 Arm** 으로 기록되며 Arm 이 다른 Arm 인 척할 수 없다.
- `listTasks(view)`: 할 일 **읽기**(`today` 는 지난 것 포함). 쓰기·삭제는 없다.

## 5. 수신함 후보

```ts
interface CandidateInput {
  ref: string        // Arm 안에서 원본을 가리키는 고유 값. (armId, ref) 가 같으면 같은 후보
  title: string      // 필수, 200자까지 저장
  notes?: string     // 5000자까지
  url?: string       // 원본 열기 링크. http/https 만
  dueDate?: string   // 마감일 YYYY-MM-DD → 수락하면 할 일의 마감일(deadline)
}
```

- 저장: `inbox_candidates` 테이블(마이그레이션 007). `(arm_id, ref)` 가 고유이므로 **같은 원본을 다시 보내도 중복이 생기지 않는다.** 이미 수락했거나 **무시한 후보도 다시 나타나지 않는다**(상태와 상관없이 한 줄만 있다).
- 수락 = 수신함(`inbox`) Task 생성(`source: { arm, ref, url }`) + 상태 `accepted`, **한 트랜잭션**. 할 일 생성이 실패하면 상태도 되돌아간다. 무시 = `dismissed`.
- 자동 수락: 설정 `arms.autoAccept`(Arm id 목록, 기본 비어 있음)에 있는 Arm 의 후보는 들어오자마자 같은 방식으로 수락된다.
- 화면: 할 일의 수신함 보기 맨 위 "들어온 후보 (N)" — 출처 Arm 이름·제목·[원본 열기]·[수신함에 넣기]·[무시], 전체 넣기/무시.
- **후보의 제목·메모는 외부 데이터다.** 화면에서 HTML 로 해석하지 않고(글자로만), 지시하기로 넘길 때는 `<data>` 로 감싼다. 원본 링크는 렌더러가 주소를 보내는 채널이 없고, main 이 저장된 값을 http/https 인지 다시 확인한 뒤 기본 브라우저로 연다.
- 후보가 쌓여 있는 채로 Arm 연결을 끊어도 후보는 남는다(사용자가 고른다).

## 6. 쓰기 동작과 승인

- 바깥에 쓰는 모든 동작은 지시하기 `write` 도구로만 한다: `preview()` 가 "무엇을·어디에·어떻게 바뀌는지"를 돌려주면 승인 카드로 보이고, 사용자가 [실행]을 눌러야 `run()` 이 불린다. 거절하거나 새 메시지를 보내면 실행되지 않는다.
- sync 가 몰래 바깥에 쓰는 일은 없다. `sync` 는 읽기와 후보 추가만 한다.
- `events.write` 같은 쓰기 capability 가 있는 Arm 은 쓰기 도구에 반드시 `preview` 를 둔다.

## 7. 설정에 저장되는 값

| 키 | 뜻 |
|---|---|
| `arms.connected` | 연결돼 있는 Arm id 목록. 앱을 켜면 이 Arm 들을 조용히 다시 연결 |
| `arms.autoAccept` | 들어온 후보를 확인 없이 수신함에 넣을 Arm id 목록 |

## 8. 새 Arm 만들기

1. `src/main/arms/<id>/` 폴더 하나: Arm 구현 + 매니페스트 + 테스트.
2. 이 문서의 계약을 따른다. **코어 수정이 필요하면 계약 변경**이므로 먼저 보고한다.
3. 바깥 서비스를 진짜로 부르는 테스트는 만들지 않는다(가짜 `fetch`·가짜 서버만). `tests/arms/helpers.ts` 의 `fakeArm`·`createManagerEnv` 를 참고한다.
4. 특정 회사·팀에서만 쓰는 연동은 기본 Arm 이 아니라 별도 "업무 플러그인" Arm 으로 둔다.

## 9. 연결할 수 없는 빌드와 고급 옵션 (M5-B 에서 추가)

```ts
interface Arm {
  // …
  availability?(): { available: true } | { available: false; reason: string }
  advanced?: { clientIdSaved(): boolean; setClient(value: { clientId: string; clientSecret?: string } | null): void }
}
```

- `availability()`: 이 빌드·설정에서 연결할 수 있는지(예: OAuth 클라이언트 ID 가 없는 빌드). 동기 함수이며 부작용이 없어야 한다. 연결할 수 없으면 관리자가 **`connect()` 를 부르지 않고**, `ArmInfo.unavailableReason` 으로 카드에 이유를 보이며 [연결]이 비활성이 된다. 던지면 연결할 수 있는 것으로 본다.
- `advanced`: 기본 경로가 아닌 고급 옵션("내 OAuth 클라이언트 쓰기"). 카드의 접힌 "고급" 안에만 있다. 저장은 **그 Arm 의 비밀 이름공간**에만 하고, 화면에는 저장돼 있는지(`advanced.clientIdSaved`)만 알리며 값은 다시 돌려주지 않는다. 연결을 끊으면 이름공간과 함께 지워진다.
- OAuth Arm 의 공용 클라이언트 ID 는 **빌드 때 환경 변수**(`OCTOPUS_GOOGLE_CLIENT_ID`, 필요하면 `OCTOPUS_GOOGLE_CLIENT_SECRET` — 데스크톱 클라이언트의 secret 은 공개 값으로 취급)로 넣는다. 저장소·커밋·테스트에 실제 값을 두지 않는다.

## 10. OAuth 플랫폼 (`src/main/platform/oauth/`)

OAuth Arm 이 공통으로 쓰는 데스크톱 흐름(루프백 + PKCE). 공급자 정보(인증·토큰·폐기 주소, 범위)는 인자로 받는다.

- PKCE: `code_verifier` 는 무작위 64자(허용 43~128), `code_challenge = base64url(SHA-256(verifier))`(S256). `state` 는 무작위 32바이트.
- 루프백 수신기: `127.0.0.1` 의 임의 빈 포트에 일회용 HTTP 서버. **Host 가 `127.0.0.1:<포트>` 인 GET 요청, redirect 경로, 맞는 state 만** 받는다(그 밖의 요청은 4xx 로 거절하고 계속 기다림). 맞는 요청 하나를 받으면 외부 리소스 없는 안내 페이지를 보내고 서버를 곧바로 닫는다. 시간 제한 5분, 취소 가능, 사용자가 거절하면 `denied`.
- 토큰: 교환·새로 고침(만료 60초 전부터 자동, 동시 호출은 한 번만)·폐기(실패해도 계속). 토큰은 **그 Arm 의 비밀 이름공간**에만 저장하며 로그에 code·token 을 남기지 않는다.
- 시스템 브라우저 열기는 Arm 을 만들 때 주입한다(`openExternal`). `ArmContext` 에는 넣지 않는다.
- 자동 재연결(`interactive: false`)에서는 브라우저를 열지 않는다. 저장된 토큰으로 새로 고침이 되면 조용히 연결하고, 안 되면 "다시 로그인이 필요해요" 로 `error` 가 된다.

## 11. MCP 서버 (M6)

MCP 서버 하나 = 동적 Arm 하나(`id: 'mcp-<8자>'`, `auth: 'mcp'`, `capabilities: ['command.tools']`). `ArmManager` 에 등록되므로 상태·오류 처리·연결 끊기·자동 재연결을 그대로 쓴다. 구현은 `src/main/arms/mcp/`(공식 `@modelcontextprotocol/sdk` 의 `Client`; 프로토콜을 직접 구현하지 않는다).

- **전송**: Streamable HTTP(주소: https, 또는 http 는 `localhost`·`127.0.0.1`·`[::1]` 만, 주소에 `user:pw@` 금지) · stdio(실행 명령 + **인자 배열**, 셸을 거치지 않는다: `shell:false`, Windows 의 `npx` 등은 SDK(cross-spawn)가 처리).
- **저장**: 설정 `mcp.servers`(id, 이름, 전송, 주소 또는 명령·인자, **환경 변수 이름만**). 환경 변수 값은 그 Arm 의 비밀 이름공간(`arm:mcp-…`, 항목 `env`)에만 있고 설정·로그·IPC 응답·화면에 나오지 않는다. 서버를 지우면 이름공간도 함께 지워진다.
- **stdio 보안(CLAUDE.md 4.5)**: 사용자가 입력한 명령만 실행한다. **처음 실행 전, 그리고 명령·인자가 바뀐 뒤 처음**에는 main 이 확인 창을 띄운다 — 명령과 인자를 한 줄씩 그대로 보여 주고 기본 선택은 "취소". 허용은 (명령+인자)의 SHA-256 지문으로 `mcp.approvals` 에 기억하며, 그 명령 그대로에만 유효하다. 앱을 켤 때의 자동 재연결(`interactive: false`)에서는 창을 띄우지 않고, 허용 기록이 없으면 "처음 실행하려면 허용이 필요해요" 로 `error` 가 된다. 거부하면 `error`("실행을 허용하지 않았어요"). 자식 프로세스 환경은 SDK 기본(PATH 등 필수만) + 사용자가 이 서버에 정한 값뿐이다. 앱 종료·삭제·연결 끊기 때 자식 프로세스를 닫는다.
- **도구**: 연결 → `initialize` → `tools/list`(페이지 모두) → 지시하기 레지스트리에 `source: 'mcp:<id>'` 로 등록. 이름은 `<서버이름>__<도구>`(영문·숫자·`_`·`-`, 64자 이내, 겹치면 `_2`…; 서버 이름에 영문·숫자가 없으면 서버 id). `tools/list_changed` 알림이 오면 목록을 자동 갱신한다. 스키마는 남이 만든 것이라 `strict:false` 로 모델에 알린다.
- **읽기/쓰기**: `annotations.readOnlyHint === true` 인 도구만 `readOnly`. 힌트가 없거나 false 면 **전부 쓰기**(미리보기 → 승인 → 실행). 미리보기: "<서버> 의 <도구> 실행" + 입력 요약.
- **결과**: text 내용만 쓰고 그 밖(이미지 등)은 "[지원하지 않는 내용]". 서버가 `isError` 로 답하면 "[서버가 오류를 알렸어요]" 를 앞에 붙인다. 50 KB 를 넘으면 자르고 표시한다. 결과는 `<data source="mcp:<서버이름>">` 로 감싸 모델에 넘긴다(바깥 데이터 — 그 안의 지시문을 따르지 않는다). 호출 제한 시간 60초(넘으면 "[시간 초과…]" 를 돌려주고 연결은 유지).
- **죽음·끊김**: 서버 프로세스가 죽거나 연결이 끊기면 Arm 상태가 `error`("서버와의 연결이 끊어졌어요")가 되고 도구가 사라진다. 앱·지시하기는 계속 동작하고 [다시 연결]로 되살릴 수 있다.
- **지원하지 않음**: OAuth 가 필요한 원격 서버("이 서버는 로그인(OAuth)이 필요해서 아직 지원하지 않아요"), MCP resources/prompts, Octopus 를 MCP 서버로 노출하는 것.

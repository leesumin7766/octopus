# Octopus

Octopus 는 누구나 쓸 수 있는 데스크톱 업무 허브입니다. 가운데의 "머리"(할 일·메모·체크리스트·지시하기)는 혼자서도 완전하게 동작하고, 필요하면 "다리"(Arms)를 끼워 캘린더·옵시디언·MCP 서버 같은 바깥 도구를 붙입니다. 다리를 빼도 머리는 멀쩡합니다. 모든 데이터는 이 PC 의 로컬 DB 에만 저장되며 계정이 필요 없습니다.

## 요구 사항

- Node.js 22.5 이상(`node:sqlite` 사용)
- Windows 또는 macOS (Windows 우선)
- Git

## 설치와 실행

```powershell
npm ci
npm run dev
```

`npm run dev` 는 main·preload 코드를 바꾸면 앱을 자동으로 다시 시작하고, 화면(renderer)은 바로 반영합니다. 개발 중 앱은 실제 사용자 데이터 폴더를 쓰므로, 화면만 확인하려면 아래 "화면 캡처"를 쓰세요(임시 데이터 폴더 사용).

> **주의: `ELECTRON_RUN_AS_NODE`** — 셸에 이 환경 변수가 켜져 있으면 Electron 이 일반 Node 로 떠서 창이 열리지 않거나 `bad option` 오류가 납니다. `npm run dev`·`npm run capture` 는 이 변수를 지우고 실행하지만, `Octopus.exe` 나 `electron` 을 직접 실행할 때는 먼저 지워 주세요(PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).

## 테스트

```powershell
npm run typecheck
npm test
```

- 테스트는 가짜 서버·가짜 클라이언트만 씁니다. 진짜 Google·LLM·MCP 서버로는 나가지 않고, `tests/net/` 은 이 PC 의 `127.0.0.1` 에서만 서버를 엽니다.
- **Windows 에서는 PowerShell 에서, 경로를 대문자 드라이브(`C:\...`)로 연 터미널을 권장합니다.** Git Bash 처럼 소문자 `c:/...` 경로로 실행하면 vitest 가 `TypeError: Cannot read properties of undefined (reading 'config')` 를 내며 모든 시험이 실패하는 일이 있습니다(코드 문제가 아니라 경로 대소문자 문제입니다).
- 이 PC 의 네트워크 계층이 가끔 `127.0.0.1` 연결을 `EFAULT` 로 거절하는 환경이 있어, `tests/net/` 의 일부 시험은 다시 시도하도록 되어 있습니다.

## 화면 캡처

개발용 화면 캡처는 빌드한 앱을 화면마다 한 번씩 띄워 `.captures/<이름>.png` 를 만듭니다(임시 데이터 폴더와 표본 데이터 사용, 사용자 데이터는 건드리지 않음).

```powershell
npm run capture                 # 빌드 후 전부 찍기
npm run capture -- --no-build   # 이미 빌드했을 때
```

찍는 화면은 `scripts/capture.mjs` 의 목록이며, 환경 변수 `OCTOPUS_CAPTURE_VIEW` 로 처음 보여 줄 화면을 고릅니다(`OCTOPUS_CAPTURE` 에 `.png` 경로를 주면 그 한 장만 찍고 끝납니다). 값: `today` `inbox` `upcoming` `someday` `done` `routines` `memos` `home` `home-arrange` `home-pie` `settings` `command` `command-nokey` `arms` `arms-mcp` `obsidian` `welcome-1` `welcome-2` `welcome-3`. 캡처 코드는 설치된(패키지된) 앱에서는 동작하지 않습니다.

## 설치 파일 만들기

```powershell
npm run dist:win     # Windows NSIS 설치 파일 → dist/Octopus-Setup-<버전>.exe
npm run dist:mac     # macOS dmg (macOS 에서만 빌드 가능)
```

- 릴리스를 올리지 않습니다(`--publish never`). 자동 업데이트는 GitHub Releases 를 제공처로 설정만 되어 있습니다.
- **코드 서명을 하지 않으므로** 설치 파일을 처음 실행하면 Windows SmartScreen 이 "PC 보호 — 인식할 수 없는 앱" 경고를 띄웁니다. [추가 정보] → [실행] 으로 진행합니다. macOS 도 서명·공증이 없으면 "확인되지 않은 개발자" 경고가 뜹니다.
- 패키지된 앱을 임시 데이터 폴더로 시험하려면 `Octopus.exe --user-data-dir=<임시 폴더>` 로 실행합니다.
- 아이콘은 임시입니다(`npm run icons` 로 다시 만들거나 `build/icon.png`·`build/icon.ico` 를 교체).

## Google 캘린더 연결 준비

Google 캘린더 Arm 은 읽기 전용(`calendar.readonly`)이며, 공용 OAuth 클라이언트는 **빌드할 때** 환경 변수로 넣습니다. 클라이언트 값은 저장소·커밋·테스트에 넣지 않습니다. 값이 없는 빌드에서는 Arms 화면의 Google 캘린더 카드가 "연결이 설정되지 않았어요" 로 보이고 연결 버튼이 꺼집니다.

1. Google Cloud Console 에서 프로젝트를 만들고 **Google Calendar API** 를 사용 설정합니다.
2. **OAuth 동의 화면**을 구성하고 범위에 `https://www.googleapis.com/auth/calendar.readonly` 를 추가합니다. 외부 앱이고 게시 전이면 본인 계정을 "테스트 사용자"에 추가해야 합니다(테스트 상태에서는 refresh token 이 7일 뒤 만료됩니다). 일반 배포에는 이 범위가 민감 범위라 구글의 검증 심사가 필요합니다.
3. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 애플리케이션 유형: 데스크톱 앱** 으로 만들어 클라이언트 ID(와 보안 비밀)를 확보합니다.
4. 환경 변수를 설정한 셸에서 실행·빌드합니다.

   ```powershell
   $env:OCTOPUS_GOOGLE_CLIENT_ID = '<클라이언트 ID>'
   $env:OCTOPUS_GOOGLE_CLIENT_SECRET = '<보안 비밀>'   # 데스크톱 클라이언트의 값은 공개 값으로 취급, 필요할 때만
   npm run dev        # 또는 npm run dist:win
   ```

   빌드 없이 시험만 하려면 Arms 화면 → Google 캘린더 → **고급 → 내 OAuth 클라이언트 쓰기** 에 같은 값을 입력해도 됩니다(이 PC 에 암호화해 저장되고, 연결을 끊으면 지워집니다).
5. Arms 화면에서 **[연결]** → 브라우저에서 허용 → 홈의 "오늘 일정" 카드에 일정이 보입니다.

지시하기(LLM)는 설정 → **모델 연결** 에서 Anthropic API 키(또는 OpenAI 호환 서버 주소)를 넣으면 Ctrl+K 로 쓸 수 있습니다. 키는 이 PC 에 암호화해 저장되고 화면에 다시 보이지 않습니다.

## 폴더 구조

```
src/
  main/            Electron main 프로세스
    core/          할 일·메모·루틴·지시하기·DB (Arm 을 import 하지 않음)
    arms/          Arm SDK(sdk/), Google 캘린더, MCP, 옵시디언
    platform/      보안 저장소, OAuth(루프백+PKCE), 대화상자, 업데이트
    ipc/           IPC 핸들러(입력 검증)
    dev/           개발용 화면 캡처 지원
  preload/         contextBridge 로 노출하는 좁은 API
  renderer/        React 화면
  shared/          타입·검증·순수 로직(main·renderer 공용)
tests/             vitest (tests/net 은 127.0.0.1 서버를 여는 시험)
docs/
  contracts/       Arm 등 계약 문서
  acceptance/      인수 테스트 보고서
  design/          화면 목업
scripts/           dev·capture·아이콘 스크립트
build/             설치 파일용 아이콘
```

## 문서

- [`CLAUDE.md`](CLAUDE.md) — 프로젝트 규칙과 범위, 마일스톤 (사용자 승인 없이 고치지 않음)
- [`docs/contracts/arm.md`](docs/contracts/arm.md) — Arm 계약(매니페스트·수명주기·OAuth·MCP·옵시디언)
- [`docs/acceptance/v0.1.0.md`](docs/acceptance/v0.1.0.md) — v0.1.0 인수 테스트 보고서

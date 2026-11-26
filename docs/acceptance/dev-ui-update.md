# UI 아이콘 정리 · 프로그램 업데이트 — 개발 기록

Claude Code / 2026-11-26 / `dev` 브랜치 (기준: 4213333 홈 개방감 정리 위)

사용자 요청:

1. 설정·화면 배치 아이콘을 ATDT 와 같게.
2. 체크리스트 아이콘을 체크 아이콘으로.
3. ATDT 의 업데이트 기능을 참고해 비슷하게 구현. 대신 업데이트 알림은 더 간단하게, 화면 자리를 차지하지 않게.

ATDT(`C:\Users\tta\ATDT`, v0.5.7)는 읽기만 했다.

---

## 1. 아이콘

ATDT 는 `lucide-react` 1.66.0 의 `Settings`(톱니바퀴)와 `LayoutGrid`(둥근 네모 4칸)를 쓴다.
Octopus 는 새 패키지를 넣지 않고 같은 모양의 SVG 경로를 `src/renderer/ui/Icon.tsx` 에 옮겼다(Lucide, ISC 라이선스, 출처를 주석에 남김).

| 위치 | 이전 | 이후 |
|---|---|---|
| 왼쪽 메뉴 · 설정 | 슬라이더 모양 선 | Lucide `settings`(톱니바퀴) |
| 왼쪽 메뉴 · 화면 배치 | 꽉 찬 가로 직사각형 4개(`LayoutIcon`) | Lucide `layout-grid`(선 아이콘, 다른 메뉴와 같은 크기·굵기). `LayoutIcon` 은 삭제 |
| 왼쪽 메뉴 · 체크리스트, 원형 메뉴 '체크리스트 화면' 칸 | 목록 + 작은 체크 | Lucide `check`(체크 표시 하나) |

- 선 굵기는 Octopus 의 다른 아이콘과 맞춰 1.8 을 유지했다(ATDT 는 2).
- '할 일' 아이콘(네모 안 체크)은 그대로 두어 체크리스트와 구분된다.
- 원형 메뉴의 '설정' 칸도 같은 톱니바퀴로 바뀐다(같은 아이콘 이름을 쓰므로).

증거: `evidence/ui-update/home-icons-900x700.png`

## 2. 프로그램 업데이트

### 2.1 ATDT 와 같게 한 것

| 항목 | 동작 |
|---|---|
| 확인 시점 | 설치한(패키지된) 앱을 켜고 5초 뒤 한 번 자동 확인. 설정에서 언제든 [업데이트 확인] |
| 받기 | 새 버전이 있으면 알리기만 한다. 사용자가 [받기]를 눌러야 받는다(`autoDownload = false`) |
| 진행률 | 받는 동안 진행률(%)을 보여 준다 |
| 설치 | 받은 뒤 [다시 시작해서 설치]를 눌러야 설치한다. 설치 화면 없이 설치하고 앱을 다시 켠다(`quitAndInstall(true, true)`) |
| 바뀐 점 | GitHub 릴리스 노트(HTML)를 글자만 남겨 보여 준다(2,000자까지) |
| 개발 모드 | 확인하지 않는다. 설정에 "개발 모드에서는 확인하지 않아요"라고 보인다 |
| 실패 | 인터넷 끊김 / 배포 정보 없음 / 그 밖 으로 나눠 다음 행동을 알려 주는 문구로 보인다. 로그에는 스택 없이 한 줄만 |
| 배포처 | 기존 `electron-builder.yml` 의 `publish`(GitHub `leesumin7766/octopus`) 그대로 |

### 2.2 ATDT 와 다르게 한 것

| 항목 | ATDT | Octopus | 이유 |
|---|---|---|---|
| 새 버전 알림 | 오른쪽 아래 떠 있는 320px 대화상자(노트·진행률·버튼) | **제목 줄 왼쪽의 한 줄 알림**(높이 28px). 카드·목록 자리를 전혀 차지하지 않는다 | 사용자 요청: 간단하게, 자리 차지하지 않게 |
| 알림 내용 | 노트 전체 + 버튼 2개 | 단계마다 한 가지: `새 버전 0.2.0 [받기]` → `받는 중 42% ▬` → `[다시 시작해서 설치]` + 닫기(×). 노트는 마우스를 올리면 보이고, 전체는 설정에 | 같음 |
| 닫기(×) | 이번 실행 동안 다시 묻지 않음 | 지금 단계만 숨김. 다음 단계(받기 완료)가 되면 다시 보임 | 받아 둔 업데이트를 잊지 않게 |
| 앱을 끌 때 자동 설치 | 켬 | **끔**(기존 Octopus 결정 유지: 설치는 사용자가 누를 때만) | 기존 테스트·결정과 일치 |
| OS 알림(창이 비활성일 때) | 있음 | 넣지 않음 | 이번 범위 밖. 필요하면 후속 |
| 업데이트 기록(활동 로그) | 있음 | 넣지 않음 | Octopus 에 활동 기록 기능이 아직 없음 |

### 2.3 화면

- **제목 줄 알림** (`src/renderer/update/UpdateChip.tsx`): 상태가 `available`·`downloading`·`ready` 일 때만 보인다. 확인 중·실패·최신은 제목 줄에 띄우지 않는다(설정에서만). `app-no-drag` 라서 창 끌기 영역 안에서도 눌린다.
  - 증거: `evidence/ui-update/titlebar-update-available.png`, `titlebar-update-downloading.png`, `titlebar-update-ready.png`
- **설정 > 업데이트** (`src/renderer/settings/UpdateSection.tsx`): 설정 화면 맨 아래. 현재 버전, 상태 문구, [업데이트 확인] / [업데이트 받기] / [다시 시작해서 설치], 진행 막대, 접히는 "바뀐 점".
  - 증거: `evidence/ui-update/settings-update-ready.png`
- 이전 설정 화면의 "새 버전 있음" 상자(새 버전이 있을 때만 맨 위에 뜨던 것)는 이 구역으로 바뀌었다.

### 2.4 구조

```
main/platform/updater.ts   상태 기계 + electron-updater 감싸기 (시험에서는 가짜 autoUpdater)
main/ipc/update.ts         채널 4개: update:state / check / download / install (인자 없음)
main/index.ts              상태가 바뀌면 열린 창에 update:event 로 밀어 줌
preload/index.ts           update.onState — 받은 값은 shared/validation/update 로 모양 확인 후에만 넘김
shared/update/types.ts     UpdateState / UpdateApi
renderer/update/useUpdate.ts   읽기 + 이벤트 따라가기 (제목 줄·설정이 같이 씀)
```

상태: `disabled`(개발 모드) · `idle` · `checking` · `latest` · `available` · `downloading` · `ready` · `error`(+ `offline`/`noRelease`/`other`).

- 확인·받기는 절대 던지지 않고 상태로 알린다. 받는 중이나 받은 뒤에는 다시 확인하지 않는다.
- 설치는 `ready` 일 때만 한다. IPC 로 아무 값을 보내도 그 외 상태에서는 아무 일도 없다.
- 코어·Arm 과 무관하다(플랫폼 기능). 업데이트가 실패해도 할 일·메모 등 앱 동작에 영향이 없다.

## 3. 테스트

| 파일 | 내용 |
|---|---|
| `tests/updater.test.ts` (다시 씀, 18건) | 개발 모드는 손대지 않음, 5초 뒤 한 번 자동 확인, 자동 받기·자동 설치 없음, 확인→있음→받기→진행률→받음→설치 흐름, 최신, 받는 중 재확인 막기, 실패 분류·한 줄 로그·재시도, 노트 HTML 정리, IPC 채널 4개, 밀어 준 상태 검증 |
| `tests/renderer/updateChip.test.tsx` (새로, 5건) | 최신이면 안 보임, 제목 줄 안·no-drag·[받기]만 받음, 진행률→설치 버튼·누를 때만 설치, ×는 다음 단계까지 숨김, 확인 중·실패는 제목 줄에 안 뜸 |
| `tests/renderer/settingsScreen.test.tsx` (업데이트 부분 다시 씀, 7건) | 현재 버전·지금 확인, 받기는 누를 때만·바뀐 점, 받는 중 진행 막대·재확인 비활성, 설치는 누를 때만, 실패 안내 문구, 개발 모드 안내, 밀어 준 상태 반영 |
| `tests/preload/api.test.ts` | 노출 함수 5개(check·download·install·onState·state), 채널 매핑, 이벤트는 한 채널·모양 틀린 값 버림·해제 |

결과(2026-11-26): `npm run typecheck` 통과, `npm test` **113개 파일 · 1,722건 통과**, `npm run build` 통과, `git diff --check` 깨끗.

실제 화면 확인: 빌드한 앱(개발 모드)을 띄워 왼쪽 메뉴 아이콘을 보고, main 프로세스에서 `update:event` 를 직접 보내 제목 줄 알림 3단계와 설정 구역을 확인했다(위 증거 이미지).

## 4. 남은 일 / 확인 못 한 것

- **진짜 업데이트는 검증하지 않았다.** GitHub `leesumin7766/octopus` 에 릴리스(설치 파일 + `latest.yml`)를 올린 적이 없고, 이번에도 올리지 않았다. 실제로 동작하려면 사용자가 릴리스를 올려야 한다(배포·태그는 사용자 승인 사항).
  - 확인(2026-11-26): `leesumin7766/octopus` 는 공개 저장소이고 릴리스는 아직 0개다. 공개라서 ATDT 처럼 배포 전용 저장소를 따로 둘 필요는 없다. 첫 릴리스 전까지 설치된 앱은 "배포된 업데이트 정보를 찾지 못했어요"를 설정에만 보인다(제목 줄에는 뜨지 않음).
- 코드 서명이 없어 Windows SmartScreen 경고가 날 수 있다(기존과 같음). macOS 는 서명 없이는 자동 업데이트가 되지 않는다.
- 창이 비활성일 때 OS 알림은 넣지 않았다.

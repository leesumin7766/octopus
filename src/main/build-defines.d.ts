// electron-vite(define)가 빌드 때 채워 넣는 값. 빌드 환경 변수가 없으면 빈 문자열이다.
declare const __OCTOPUS_GOOGLE_CLIENT_ID__: string
declare const __OCTOPUS_GOOGLE_CLIENT_SECRET__: string
// 개발용 캡처 도구를 넣을지(OCTOPUS_DEV_TOOLS=1 로 빌드할 때만 true). 배포 빌드에서는 false 라서 캡처 코드가 빠진다.
declare const __OCTOPUS_DEV_TOOLS__: boolean

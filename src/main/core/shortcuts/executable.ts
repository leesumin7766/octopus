// 열면 프로그램이 실행되는 파일 형식. 이런 바로가기는 처음 열 때 사용자에게 확인을 받는다.
const EXECUTABLE_EXTENSIONS: readonly string[] = [
  // Windows
  '.exe', '.com', '.bat', '.cmd', '.lnk', '.ps1', '.vbs', '.vbe', '.wsf', '.wsh', '.js', '.jse', '.msi', '.msp', '.scr', '.cpl', '.reg', '.hta', '.jar',
  // macOS
  '.app', '.command', '.pkg', '.dmg', '.workflow', '.action',
  // Linux·공통
  '.sh', '.bash', '.run', '.appimage', '.desktop'
]

/** 경로의 확장자(대소문자 무시)가 실행 형식이면 true */
export function isExecutablePath(path: string): boolean {
  const lower = path.toLowerCase().replace(/[\\/]+$/, '')
  return EXECUTABLE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

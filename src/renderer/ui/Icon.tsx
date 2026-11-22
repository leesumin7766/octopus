// 인라인 SVG 아이콘(목업의 선 아이콘). 이모지는 쓰지 않는다.

const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  tasks: 'M4 4h16v16H4zM8 12l3 3 5-6',
  checklist: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  memo: 'M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6',
  command: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  arms: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 9V3M12 15v6M9 12H3M15 12h6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  wiki: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5',
  obsidian: 'M12 3l6 5-2 12H8L6 8zM6 8h12M12 3l-2 17M12 3l4 17',
  plus: 'M12 5v14M5 12h14',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6'
} as const

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** "화면 배치" 버튼의 2×2 격자 아이콘 */
export function LayoutIcon() {
  return (
    <svg aria-hidden="true" width="26" height="18" viewBox="0 0 40 26" fill="currentColor" className="shrink-0">
      <rect x="0" y="0" width="18" height="11" rx="2" />
      <rect x="22" y="0" width="18" height="11" rx="2" />
      <rect x="0" y="15" width="18" height="11" rx="2" />
      <rect x="22" y="15" width="18" height="11" rx="2" />
    </svg>
  )
}

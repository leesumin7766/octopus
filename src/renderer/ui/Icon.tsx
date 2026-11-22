// 인라인 SVG 아이콘(목업의 선 아이콘). 이모지는 쓰지 않는다.

const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  tasks: 'M4 4h16v16H4zM8 12l3 3 5-6',
  checklist: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  memo: 'M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6',
  command: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  arms: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 9V3M12 15v6M9 12H3M15 12h6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'
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

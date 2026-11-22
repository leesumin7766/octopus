import type { ChangeEventHandler } from 'react'

interface CheckboxProps {
  checked: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
  'aria-label': string
}

/** 목업처럼 둥근 네모 체크박스. 실제 입력은 그대로 checkbox 라서 키보드·스크린 리더가 똑같이 쓴다. */
export function Checkbox({ checked, onChange, 'aria-label': label }: CheckboxProps) {
  return (
    <span className="relative inline-flex size-5 shrink-0">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="peer size-5 cursor-pointer appearance-none rounded-md border-2 border-[#7c7b76] bg-white checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100"
      >
        <path d="M3 7.5l2.5 2.5L11 4.5" />
      </svg>
    </span>
  )
}

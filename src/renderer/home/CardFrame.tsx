import type { CSSProperties, ReactNode } from 'react'
import { movableDirections, type CardId, type Direction } from '../../shared/home/layout'
import { ko } from '../i18n/ko'
import { useScrollingFlag } from '../ui/useScrollingFlag'

const t = ko.home

interface CardFrameProps {
  card: CardId
  /** 자리 번호 0..3 (왼위·오른위·왼아래·오른아래) */
  position: number
  arranging: boolean
  onMove: (card: CardId, direction: Direction) => void
  style: CSSProperties
  children: ReactNode
  /** 카드 아래 고정 영역(예: "전체 보기 →"). 스크롤 밖에 있어 항상 보인다. */
  footer?: ReactNode
}

/**
 * 홈 카드의 겉모양: 흰 바탕, 1px 테두리, 12px 둥글기. 배치 모드에서는 이웃과 자리를 바꾸는 화살표가 붙는다.
 * 본문만 스크롤되고, 제목과 아래쪽 고정 영역은 그대로 보인다.
 */
export function CardFrame({ card, position, arranging, onMove, style, children, footer }: CardFrameProps) {
  const title = t.cards[card]
  const onScroll = useScrollingFlag()

  return (
    <section
      aria-label={title}
      data-position={position}
      style={style}
      className={`flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-line bg-white px-4 py-3.5 ${
        arranging ? 'outline-2 -outline-offset-2 outline-dashed outline-accent' : ''
      }`}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        {arranging && (
          <div className="flex gap-1">
            {movableDirections(position).map((direction) => (
              <button
                key={direction}
                type="button"
                aria-label={t.moveLabel(title, t.directions[direction])}
                title={t.moveLabel(title, t.directions[direction])}
                onClick={() => onMove(card, direction)}
                className="size-8 rounded-lg border border-[#c9c7f0] bg-white text-[15px] leading-none text-ink hover:bg-accent-soft"
              >
                {t.arrows[direction]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div onScroll={onScroll} className="scroll-quiet flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto">
        {children}
      </div>
      {footer && <div className="shrink-0">{footer}</div>}
    </section>
  )
}

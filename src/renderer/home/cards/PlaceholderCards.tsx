import { ko } from '../../i18n/ko'

/** 오늘 일정: 캘린더 Arm 이 아직 없어서 빈 상태와 연결 안내만 보여 준다. */
export function CalendarCard() {
  const t = ko.home.calendar
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-[#5e5d58]">{t.empty}</p>
      <button
        type="button"
        aria-disabled="true"
        title={t.connectSoon}
        className="min-h-9 cursor-not-allowed rounded-lg border border-line bg-white px-3 text-sm text-ink opacity-50"
      >
        {t.connect}
      </button>
      <p className="text-xs text-[#5e5d58]">{t.connectSoon}</p>
    </div>
  )
}

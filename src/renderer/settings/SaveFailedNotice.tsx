import { ko } from '../i18n/ko'

const t = ko.settings

/** 설정 저장이 실패했을 때 짧게 알리고 다시 저장하게 하는 띠. 설정을 쓰는 화면마다 같은 모양으로 둔다. */
export function SaveFailedNotice({ onRetry, saving = false, className = '' }: { onRetry: () => void; saving?: boolean; className?: string }) {
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2.5 py-2 ${className}`}>
      <span className="min-w-0 flex-1 text-xs text-red-800">{t.saveFailed}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={saving}
        className="min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] text-ink hover:bg-black/5 disabled:opacity-50"
      >
        {t.saveRetry}
      </button>
    </div>
  )
}

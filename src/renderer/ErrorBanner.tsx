import type { IpcError } from '../shared/ipc'
import { ko } from './i18n/ko'
import { errorMessage } from './tasks/errors'

interface ErrorBannerProps {
  error: IpcError
  onDismiss: () => void
}

/** 오류 코드에 맞는 안내 문구와 닫기 버튼. */
export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 bg-red-50 px-5 py-2 text-sm text-red-800">
      <span>{errorMessage(error)}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs underline">
        {ko.tasks.errors.dismiss}
      </button>
    </div>
  )
}

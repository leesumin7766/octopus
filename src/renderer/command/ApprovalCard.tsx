import type { PendingApproval } from '../../shared/command/types'
import { ko } from '../i18n/ko'
import { sourceLabel, toolLabel } from './commandText'

const t = ko.command

interface ApprovalCardProps {
  approval: PendingApproval
  /** 이미 고른 결정(여러 카드 중 일부만 골랐을 때) */
  choice: boolean | undefined
  disabled: boolean
  onChoose: (callId: string, approve: boolean) => void
}

/** 쓰기 동작의 미리보기 카드. 사용자가 [실행]을 눌러야만 실행된다. */
export function ApprovalCard({ approval, choice, disabled, onChoose }: ApprovalCardProps) {
  return (
    <section aria-label={`${t.approvalLabel}: ${approval.preview.title}`} className="rounded-xl border-2 border-accent bg-accent-soft p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-accent-strong">
        <span className="font-bold">{toolLabel(approval.toolName)}</span>
        <span className="rounded-full bg-white px-2 py-0.5">{sourceLabel(approval.source)}</span>
      </div>
      <p className="text-sm font-semibold text-ink">{approval.preview.title}</p>
      {approval.preview.lines.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-[13px] text-[#3d3c38]">
          {approval.preview.lines.map((line, index) => (
            <li key={index} className="whitespace-pre-wrap break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
      {choice === undefined ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChoose(approval.callId, true)}
            className="min-h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
          >
            {t.approve}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChoose(approval.callId, false)}
            className="min-h-9 rounded-lg border border-[#c9c7f0] bg-white px-4 text-sm text-ink hover:bg-white/70 disabled:opacity-40"
          >
            {t.reject}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-accent-strong">{choice ? t.approved : t.rejected}</p>
      )}
    </section>
  )
}

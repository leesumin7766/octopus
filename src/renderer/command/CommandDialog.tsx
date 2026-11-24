import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CommandErrorKind, ConversationSummary, ModelEntry, PendingApproval, TranscriptItem, TurnState } from '../../shared/command/types'
import type { IpcError } from '../../shared/ipc'
import { notifyDataChanged } from '../dataEvents'
import { ko } from '../i18n/ko'
import { useSetting } from '../settings/useSetting'
import { errorMessage } from '../tasks/errors'
import { ApprovalCard } from './ApprovalCard'
import { errorText, runningLine, toolLine } from './commandText'
import { useModelStatus } from './useModelStatus'

const t = ko.command

interface CommandDialogProps {
  onClose: () => void
  /** "모델 연결하기": 설정 화면으로 */
  onOpenSettings: () => void
  /** 개발용 캡처: 가장 최근 대화를 바로 열어 둔다. */
  openLatest?: boolean
  /** 개발용 캡처: 열리면 이 말을 바로 보낸다(스트리밍 중간 화면용). */
  autoSend?: string
}

/** 글이 쌓이는 동안 맨 아래를 따라가다가, 사용자가 이 거리(px)보다 더 위로 올리면 멈춘다. */
const STICK_PX = 24

/** 사용할 모델: 고른 것이 목록에 있으면 그것, 아니면 쓸 수 있는 첫 모델, 아니면 첫 모델 */
function chooseModel(models: ModelEntry[], hasKey: Record<string, boolean>, selected: string): ModelEntry | undefined {
  const usable = (m: ModelEntry): boolean => m.provider === 'openai-compatible' || hasKey.anthropic
  return models.find((m) => m.id === selected && usable(m)) ?? models.find(usable) ?? models[0]
}

/**
 * 지시하기 창(Ctrl+K). 위는 대화, 아래는 입력. 쓰기 동작은 승인 카드에서 [실행]을 눌러야 실행된다.
 * 모델의 글은 HTML 이 아니라 글자로만 그린다.
 */
export function CommandDialog({ onClose, onOpenSettings, openLatest = false, autoSend }: CommandDialogProps) {
  const status = useModelStatus()
  const selected = useSetting('command.model')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [pending, setPending] = useState<PendingApproval[]>([])
  const [choices, setChoices] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [errorKind, setErrorKind] = useState<CommandErrorKind | null>(null)
  const [ipcError, setIpcError] = useState<IpcError | null>(null)
  const [text, setText] = useState('')
  const [chats, setChats] = useState<ConversationSummary[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // 스트리밍 중인 답: 첫 조각 전에는 null("생각 중…"), 조각이 오면 이어 붙인다.
  const [streaming, setStreaming] = useState<string | null>(null)
  // 거절(refusal)로 끝나서 흘려보낸 글을 안내로 바꾼 상태
  const [replaced, setReplaced] = useState(false)
  // 읽기 도구를 실행하는 중이면 그 이름
  const [toolName, setToolName] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const opener = useRef<Element | null>(document.activeElement)
  const busyRef = useRef(false)
  const conversationRef = useRef<string | null>(null)
  const stickRef = useRef(true)
  const afterTool = useRef(false)
  const autoSent = useRef(false)
  busyRef.current = busy
  conversationRef.current = conversationId

  const model = chooseModel(status.models, status.hasKey, typeof selected.value === 'string' ? selected.value : '')
  const noKey = status.loaded && !status.connected

  useEffect(() => {
    mounted.current = true
    const previous = opener.current as HTMLElement | null
    return () => {
      mounted.current = false
      previous?.focus?.()
      // 창을 닫으면 진행 중인 요청도 멈춘다.
      if (busyRef.current) void window.octopus.command.cancel(conversationRef.current)
    }
  }, [])

  // main 이 밀어 주는 진행 이벤트(이 창에만 온다). 보내는 동안의 표시용이다.
  useEffect(() => {
    return window.octopus.command.onEvent((event) => {
      if (!mounted.current || !busyRef.current) return
      if (event.kind === 'text') {
        const gap = afterTool.current
        afterTool.current = false
        setReplaced(false)
        setToolName(null)
        setStreaming((current) => (current === null ? event.text : `${current}${gap ? '\n\n' : ''}${event.text}`))
      } else if (event.kind === 'replace') {
        setStreaming(null)
        setReplaced(true)
      } else if (event.kind === 'tool') {
        afterTool.current = true
        setToolName(event.name)
      }
    })
  }, [])

  function clearStream(): void {
    setStreaming(null)
    setReplaced(false)
    setToolName(null)
    afterTool.current = false
  }

  // Esc 로 닫는다(입력 중이어도).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    inputRef.current?.focus()
  }, [status.loaded])

  // 새 글이 생기면 맨 아래로. 사용자가 위로 올려 읽는 중이면 따라가지 않는다.
  useEffect(() => {
    const log = logRef.current
    if (log && stickRef.current) log.scrollTop = log.scrollHeight
  }, [items, pending, busy, errorKind, streaming, replaced, toolName])

  const loadChats = useCallback(async (): Promise<ConversationSummary[]> => {
    const result = await window.octopus.command.conversations()
    const list = result.ok ? result.data : []
    if (mounted.current) setChats(list)
    return list
  }, [])

  const openChat = useCallback(async (id: string): Promise<void> => {
    const [transcript, waiting] = await Promise.all([window.octopus.command.transcript(id), window.octopus.command.pending(id)])
    if (!mounted.current) return
    setConversationId(id)
    setItems(transcript.ok ? transcript.data : [])
    setPending(waiting.ok ? waiting.data : [])
    setChoices({})
    setErrorKind(null)
    setIpcError(null)
  }, [])

  useEffect(() => {
    void loadChats().then((list) => {
      if (openLatest && list.length > 0) void openChat(list[0].id)
    })
  }, [loadChats, openChat, openLatest])

  function newChat(): void {
    setConversationId(null)
    setItems([])
    setPending([])
    setChoices({})
    setErrorKind(null)
    setIpcError(null)
    inputRef.current?.focus()
  }

  /** 결과를 화면에 반영한다. 데이터를 바꾼 쓰기 도구가 실행됐으면 다른 화면이 새로 읽게 알린다. */
  function apply(turn: TurnState, skipFirstUser: boolean): void {
    setConversationId(turn.conversationId)
    const added = skipFirstUser && turn.items[0]?.kind === 'user' ? turn.items.slice(1) : turn.items
    setItems((current) => [...current, ...added])
    setPending(turn.pending)
    setChoices({})
    setErrorKind(turn.status === 'error' ? (turn.error ?? 'unknown') : null)
    if (turn.items.some((item) => item.kind === 'tool' && !item.readOnly && item.status === 'done')) notifyDataChanged()
    void loadChats()
  }

  async function send(override?: string): Promise<void> {
    const body = (override ?? text).trim()
    if (busy || body === '' || !model) return
    // 첫 이벤트가 다시 그리기보다 먼저 올 수 있어서, 보내는 중이라는 표시는 바로 켠다.
    busyRef.current = true
    setBusy(true)
    if (override === undefined) setText('')
    clearStream()
    stickRef.current = true
    setErrorKind(null)
    setIpcError(null)
    // 승인 카드가 떠 있는 채로 보내면 그 카드는 거절 처리된다.
    const dropped: TranscriptItem[] = pending.map((p) => ({ kind: 'tool', name: p.toolName, source: p.source, readOnly: false, status: 'rejected', summary: p.preview.title }))
    setItems((current) => [...current, ...dropped, { kind: 'user', text: body }])
    setPending([])
    const result = await window.octopus.command.send({ conversationId, modelId: model.id, text: body })
    if (!mounted.current) return
    setBusy(false)
    clearStream()
    if (result.ok) apply(result.data, true)
    else setIpcError(result.error)
    inputRef.current?.focus()
  }

  async function submitDecisions(next: Record<string, boolean>): Promise<void> {
    if (conversationId === null) return
    busyRef.current = true
    setBusy(true)
    clearStream()
    stickRef.current = true
    const decisions = pending.map((p) => ({ callId: p.callId, approve: next[p.callId] === true }))
    const result = await window.octopus.command.decide(conversationId, decisions)
    if (!mounted.current) return
    setBusy(false)
    clearStream()
    if (result.ok) apply(result.data, false)
    else setIpcError(result.error)
  }

  /** 진행 중인 요청을 멈춘다. 멈춘 턴의 결과(받은 글 + "(중지됨)")는 send/decide 가 돌려준다. */
  async function stop(): Promise<void> {
    await window.octopus.command.cancel(conversationRef.current)
  }

  // 개발용 캡처: 모델이 정해지면 정해 둔 말을 한 번 보낸다.
  useEffect(() => {
    if (!autoSend || autoSent.current || !model || !status.loaded || noKey) return
    autoSent.current = true
    void send(autoSend)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, model, status.loaded, noKey])

  function choose(callId: string, approve: boolean): void {
    const next = { ...choices, [callId]: approve }
    setChoices(next)
    // 모든 카드에 결정이 모이면 한 번에 보낸다.
    if (pending.every((p) => next[p.callId] !== undefined)) void submitDecisions(next)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // 한글 조합 중의 Enter 는 글자를 확정하는 키라서 보내지 않는다.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    void send()
  }

  async function remove(id: string): Promise<void> {
    await window.octopus.command.removeConversation(id)
    setConfirmDelete(null)
    if (id === conversationId) newChat()
    void loadChats()
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/35 px-4 pt-10"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={t.title} className="flex h-[min(640px,calc(100vh-80px))] w-full max-w-3xl overflow-hidden rounded-[14px] bg-white shadow-xl">
        <aside aria-label={t.chatsLabel} className="flex w-44 shrink-0 flex-col gap-2 border-r border-line bg-page p-2.5">
          <button type="button" onClick={newChat} className="min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong">
            {t.newChat}
          </button>
          <h3 className="px-1 text-[11px] font-semibold text-[#6b6a65]">{t.recentChats}</h3>
          {chats.length === 0 ? (
            <p className="px-1 text-xs text-[#6b6a65]">{t.noChats}</p>
          ) : (
            <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
              {chats.map((chat) => (
                <li key={chat.id} className="group flex items-center gap-0.5">
                  {confirmDelete === chat.id ? (
                    <div role="alert" className="flex w-full flex-col gap-1 rounded-lg bg-white p-1.5 text-xs">
                      <span>{t.deleteConfirm}</span>
                      <span className="flex gap-1">
                        <button type="button" onClick={() => void remove(chat.id)} className="rounded bg-[#c0392b] px-2 py-1 text-white">
                          {t.deleteYes}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="rounded border border-line px-2 py-1">
                          {t.deleteNo}
                        </button>
                      </span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void openChat(chat.id)}
                        aria-current={chat.id === conversationId ? 'true' : undefined}
                        className={`min-h-8 min-w-0 flex-1 truncate rounded-lg px-2 text-left text-[13px] hover:bg-black/5 ${chat.id === conversationId ? 'bg-white font-semibold text-accent' : 'text-ink'}`}
                      >
                        {chat.title}
                      </button>
                      <button
                        type="button"
                        aria-label={t.deleteChat(chat.title)}
                        onClick={() => setConfirmDelete(chat.id)}
                        className="size-7 shrink-0 rounded text-[#6b6a65] opacity-0 hover:bg-black/5 focus:opacity-100 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <h2 className="text-base font-bold text-ink">{t.title}</h2>
            <span className="text-xs text-[#6b6a65]">{t.shortcutHint}</span>
            {model && !noKey && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-[#4a4945]">
                {t.modelLabel}
                <select
                  value={model.id}
                  disabled={busy}
                  onChange={(event) => {
                    selected.setLocal(event.target.value)
                    selected.persist(event.target.value)
                  }}
                  className="min-h-8 max-w-44 rounded-lg border border-[#dad9d4] bg-white px-1.5 text-xs"
                >
                  {status.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" aria-label={t.close} onClick={onClose} className={`size-9 rounded-lg text-lg text-[#4a4945] hover:bg-black/5 ${model && !noKey ? '' : 'ml-auto'}`}>
              ×
            </button>
          </header>

          {noKey ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
              <h3 className="text-base font-semibold text-ink">{t.noKey.title}</h3>
              <p className="max-w-sm text-sm text-[#4a4945]">{t.noKey.body}</p>
              <button type="button" onClick={onOpenSettings} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong">
                {t.noKey.button}
              </button>
            </div>
          ) : (
            <div
              ref={logRef}
              role="log"
              aria-label={t.conversationLabel}
              aria-live="polite"
              onScroll={(event) => {
                const el = event.currentTarget
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
              }}
              className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
            >
              {items.length === 0 && pending.length === 0 && !busy && <p className="m-auto max-w-xs text-center text-sm text-[#6b6a65]">{t.empty}</p>}
              {items.map((item, index) =>
                item.kind === 'tool' ? (
                  <p key={index} className={`text-xs ${item.status === 'error' ? 'text-[#a33a2d]' : 'text-[#6b6a65]'}`}>
                    ▸ {toolLine(item)}
                  </p>
                ) : (
                  <div key={index} className={`flex flex-col ${item.kind === 'user' ? 'items-end' : 'items-start'}`}>
                    <span className="mb-0.5 text-[11px] text-[#6b6a65]">{item.kind === 'user' ? t.you : t.assistant}</span>
                    <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm ${item.kind === 'user' ? 'bg-accent text-white' : 'bg-page text-ink'}`}>{item.text}</p>
                  </div>
                )
              )}
              {pending.map((approval) => (
                <ApprovalCard key={approval.callId} approval={approval} choice={choices[approval.callId]} disabled={busy} onChoose={choose} />
              ))}
              {pending.length > 0 && <p className="text-xs text-[#6b6a65]">{t.approvalHint}</p>}
              {busy && (streaming !== null || replaced) && (
                // 흘러오는 글. 글자로만 그린다(HTML 로 해석하지 않는다).
                <div className="flex flex-col items-start">
                  <span className="mb-0.5 text-[11px] text-[#6b6a65]">{t.assistant}</span>
                  <p data-testid="streaming-bubble" className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-page px-3 py-2 text-sm text-ink">
                    {replaced ? t.refusalReplaced : streaming}
                  </p>
                </div>
              )}
              {busy && toolName !== null && (
                <p role="status" className="text-xs text-[#6b6a65]">
                  {runningLine(toolName)}
                </p>
              )}
              {busy && streaming === null && !replaced && toolName === null && (
                <p role="status" className="text-sm text-[#6b6a65]">
                  {t.thinking}
                </p>
              )}
              {errorKind && (
                <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-[#fbeceb] px-3 py-2 text-sm text-[#7d2a21]">
                  <span>{errorText(errorKind)}</span>
                  {errorKind === 'no_key' && (
                    <button type="button" onClick={onOpenSettings} className="min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white">
                      {t.noKey.button}
                    </button>
                  )}
                </div>
              )}
              {ipcError && (
                <p role="alert" className="rounded-lg bg-[#fbeceb] px-3 py-2 text-sm text-[#7d2a21]">
                  {errorMessage(ipcError)}
                </p>
              )}
            </div>
          )}

          <div className="border-t border-line p-3">
            <textarea
              ref={inputRef}
              aria-label={t.inputLabel}
              placeholder={t.placeholder}
              value={text}
              rows={2}
              disabled={busy || noKey}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              className="w-full resize-none rounded-lg border border-[#dad9d4] bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-page"
            />
            <div className="mt-1.5 flex justify-end">
              {busy ? (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="min-h-9 rounded-lg border border-[#c9c7f0] bg-white px-4 text-sm font-semibold text-accent-strong hover:bg-accent-soft"
                >
                  {t.stop}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={noKey || text.trim() === ''}
                  className="min-h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
                >
                  {t.send}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import type { Approval } from '../types'
import { useOneAI } from '../state/store'

const BASE = import.meta.env.VITE_NTFY_BASE_URL as string | undefined
const TOPIC_NOTIFY = (import.meta.env.VITE_NTFY_TOPIC_NOTIFY as string) || 'limengyi-notify'
const TOPIC_APPROVALS = (import.meta.env.VITE_NTFY_TOPIC_APPROVALS as string) || 'limengyi-approvals'

interface NtfyEvent {
  event?: string
  topic?: string
  title?: string
  message?: string
  tags?: string[]
}

function looksLikeApproval(obj: unknown): obj is Approval {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'id' in (obj as any) &&
    'action' in (obj as any) &&
    'summary' in (obj as any)
  )
}

function handle(ev: NtfyEvent) {
  if (ev.event && ev.event !== 'message') return
  const { addApproval, pushActivity } = useOneAI.getState()

  // 審核訊息:message 為 Approval 的 JSON
  if (ev.message) {
    try {
      const parsed = JSON.parse(ev.message)
      if (looksLikeApproval(parsed)) {
        addApproval({
          ...parsed,
          createdAt: parsed.createdAt ?? Date.now(),
          timeoutSec: parsed.timeoutSec ?? 1800,
        })
        return
      }
    } catch {
      // 非 JSON,當一般通知
    }
  }
  pushActivity('info', ev.title ? `${ev.title}: ${ev.message ?? ''}` : ev.message ?? '通知')
}

function openSSE(topic: string) {
  if (!BASE) return () => {}
  const url = `${BASE.replace(/\/$/, '')}/${topic}/sse`
  let es: EventSource | null = null
  let closed = false

  const connect = () => {
    if (closed) return
    es = new EventSource(url)
    es.onopen = () => useOneAI.getState().setConnected(true)
    es.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data) as NtfyEvent)
      } catch {
        /* ignore keepalive */
      }
    }
    es.onerror = () => {
      useOneAI.getState().setConnected(false)
      es?.close()
      if (!closed) setTimeout(connect, 3000)
    }
  }
  connect()
  return () => {
    closed = true
    es?.close()
  }
}

/** 連線 ntfy 通知與審核兩個 topic 的即時串流。回傳取消函式。 */
export function connectNtfy(): () => void {
  const stopA = openSSE(TOPIC_NOTIFY)
  const stopB = openSSE(TOPIC_APPROVALS)
  return () => {
    stopA()
    stopB()
  }
}

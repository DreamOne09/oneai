// 任務佇列客戶端 — ChatInput / AgyPanel / CursorPanel 共用

const APPROVAL_BASE = (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const APPROVAL_TOKEN = import.meta.env.VITE_APPROVAL_TOKEN as string | undefined

function authHeaders(): Record<string, string> {
  return APPROVAL_TOKEN ? { Authorization: `Bearer ${APPROVAL_TOKEN}` } : {}
}

export interface TaskPollResult {
  status: string
  type?: string
  payload?: { prompt?: string; cwd?: string; cmd?: string }
  result?: {
    summary?: string
    stdout_tail?: string
    stderr_tail?: string
    output?: string
  }
}

/** 從 worker 回報取出可讀摘要（Cursor 用 output，agy 用 stdout_tail） */
export function extractTaskOutput(data: TaskPollResult): string {
  const r = data.result
  if (!r) return ''
  return (r.output || r.stdout_tail || r.summary || '').trim()
}

export function formatTaskSummary(status: string, data: TaskPollResult): string {
  const out = extractTaskOutput(data)
  const err = (data.result?.stderr_tail || '').trim()
  if (status === 'done') {
    return out ? `✅ 完成\n${out.slice(0, 400)}` : '✅ 完成'
  }
  if (status === 'rejected') return '⛔ 未授權'
  if (status === 'error') return err ? `❌ 失敗\n${err.slice(0, 200)}` : (out ? `❌ 失敗\n${out.slice(0, 200)}` : '❌ 失敗')
  return status
}

/** 派送任務到 approval-svc 佇列 */
export async function dispatchTask(type: string, payload: Record<string, unknown>): Promise<string> {
  if (!APPROVAL_BASE) throw new Error('未設定 VITE_APPROVAL_BASE_URL')
  const r = await fetch(`${APPROVAL_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ type, payload }),
  })
  if (!r.ok) throw new Error(`dispatch failed: ${r.status}`)
  const data = await r.json() as { task_id?: string; id?: string }
  return data.task_id ?? data.id ?? ''
}

/** 查詢單次任務狀態 */
export async function pollTaskOnce(taskId: string): Promise<TaskPollResult> {
  const r = await fetch(`${APPROVAL_BASE}/tasks/${taskId}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`poll failed: ${r.status}`)
  return r.json() as Promise<TaskPollResult>
}

/** 輪詢直到完成或逾時（預設 90s） */
export async function pollTaskUntilDone(
  taskId: string,
  opts?: { timeoutMs?: number; onStatus?: (status: string) => void },
): Promise<{ status: string; summary: string }> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 90_000)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500))
    const data = await pollTaskOnce(taskId)
    const st = data.status ?? '...'
    opts?.onStatus?.(st)
    if (st === 'done' || st === 'error' || st === 'rejected') {
      return { status: st, summary: formatTaskSummary(st, data) }
    }
  }
  return { status: 'timeout', summary: '⏱ 等待逾時（90s），請查看 Agents 分頁或桌機 Cursor' }
}

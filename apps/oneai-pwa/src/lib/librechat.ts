// OneAI 聊天客戶端 — 呼叫 approval-svc /chat/orchestrate（多 Agent 協作）。
// ⚠️ 安全說明：
//   VITE_CHAT_TOKEN → ONEAI_CHAT_TOKEN（前端專用低權限 token，只能呼叫 /chat*）
//   VITE_APPROVAL_TOKEN → 完整 service token，僅用於 /tasks 等高權限端點
//   兩者請設定不同值（正式環境）

const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined
// 優先使用 CHAT_TOKEN（低權限），未設定時 fallback 到 APPROVAL_TOKEN（向後相容）
const CHAT_TOKEN = (import.meta.env.VITE_CHAT_TOKEN as string | undefined)
  ?? (import.meta.env.VITE_APPROVAL_TOKEN as string | undefined)

export type History = Array<{ role: 'user' | 'assistant'; content: string }>

export interface AgentContrib {
  id: string
  icon: string
  display: string
  reply: string
  model: string
}

export interface OrchestrateResult {
  reply: string
  model: string | null
  agents: AgentContrib[]   // 參與本次回覆的子 Agent 列表
  memories_used?: number   // 本次注入了幾條長期記憶
  can_execute?: boolean    // Engineer 回覆含可執行程式碼
  execute_code?: string    // 擷取的程式碼（供 Cursor dispatch）
}

/** 透過 Orchestrator 發送訊息，回傳合成回覆 + 參與的 Agent 清單。 */
export async function orchestrate(
  text: string,
  history: History = [],
): Promise<OrchestrateResult> {
  if (!APPROVAL_BASE) {
    await new Promise((r) => setTimeout(r, 800))
    return {
      reply: `（示範模式）收到：${text}`,
      model: null,
      agents: [{ id: 'assistant', icon: '🧠', display: 'OneAI', reply: `（示範模式）`, model: 'demo' }],
    }
  }

  const messages: History = [...history, { role: 'user', content: text }]
  const res = await fetch(`${APPROVAL_BASE.replace(/\/$/, '')}/chat/orchestrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CHAT_TOKEN ? { Authorization: `Bearer ${CHAT_TOKEN}` } : {}),
    },
    body: JSON.stringify({ messages }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>
    throw new Error(err.error ?? `Orchestrate ${res.status}`)
  }

  const data = await res.json() as {
    reply?: string; model?: string; agents?: AgentContrib[]
    memories_used?: number; can_execute?: boolean; execute_code?: string
  }
  return {
    reply: data.reply ?? '(無回覆)',
    model: data.model ?? null,
    agents: data.agents ?? [],
    memories_used: data.memories_used ?? 0,
    can_execute: data.can_execute ?? false,
    execute_code: data.execute_code,
  }
}

/** 向下相容舊呼叫介面。 */
export async function sendMessageWithMeta(
  text: string,
  history: History = [],
): Promise<{ reply: string; model: string | null }> {
  const r = await orchestrate(text, history)
  return { reply: r.reply, model: r.model }
}

export async function sendMessage(text: string, history: History = []): Promise<string> {
  const { reply } = await sendMessageWithMeta(text, history)
  return reply
}

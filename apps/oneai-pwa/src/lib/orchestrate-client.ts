// OneAI 編排客戶端 — 呼叫 approval-svc /chat/orchestrate（多 Agent 協作）。
// ⚠️ 安全說明：
//   VITE_CHAT_TOKEN → ONEAI_CHAT_TOKEN（前端專用低權限 token，只能呼叫 /chat*）
//   VITE_APPROVAL_TOKEN → 完整 service token，僅用於 /tasks 等高權限端點
//   兩者請設定不同值（正式環境）

const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined
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

export interface BrainMeta {
  memories_used: number
  memory_preview?: string[]
  remembered?: boolean
}

export interface WebSearchMeta {
  query: string
  provider: string
  sources: Array<{ title: string; url: string }>
  result_count: number
}

export interface OrchestrateResult {
  reply: string
  model: string | null
  agents: AgentContrib[]
  memories_used?: number
  brain?: BrainMeta
  web_search?: WebSearchMeta
  browser_research?: { task_id: string; status: string; mode: string }
  synthesis?: boolean
  can_execute?: boolean
  execute_code?: string
}

export type OrchestratePhase =
  | 'rag_start' | 'rag_done'
  | 'route_done'
  | 'search_start' | 'search_done'
  | 'browser_research_queued'
  | 'agent_done'
  | 'synth_start' | 'synth_done'
  | 'memory_saved' | 'skill_saved'
  | 'done'
  | 'error'

export interface OrchestratePhaseEvent {
  phase: OrchestratePhase
  label?: string
  data?: Record<string, unknown>
}

function parseOrchestratePayload(data: Record<string, unknown>): OrchestrateResult {
  return {
    reply: (data.reply as string) ?? '(無回覆)',
    model: (data.model as string | null) ?? null,
    agents: (data.agents as AgentContrib[]) ?? [],
    memories_used: (data.memories_used as number) ?? (data.brain as BrainMeta)?.memories_used ?? 0,
    brain: data.brain as BrainMeta | undefined,
    web_search: data.web_search as WebSearchMeta | undefined,
    browser_research: data.browser_research as OrchestrateResult['browser_research'],
    synthesis: (data.synthesis as boolean) ?? ((data.agents as AgentContrib[])?.length ?? 0) > 1,
    can_execute: (data.can_execute as boolean) ?? false,
    execute_code: data.execute_code as string | undefined,
  }
}

/** SSE 串流 orchestrate — 真實思考進度 + 最終結果。 */
export async function orchestrateStream(
  text: string,
  history: History = [],
  onPhase?: (ev: OrchestratePhaseEvent) => void,
): Promise<OrchestrateResult> {
  if (!APPROVAL_BASE) {
    await new Promise((r) => setTimeout(r, 600))
    onPhase?.({ phase: 'rag_done', label: '記憶檢索' })
    onPhase?.({ phase: 'route_done', label: '路由決策' })
    onPhase?.({ phase: 'done', label: '完成' })
    return orchestrate(text, history)
  }

  const messages: History = [...history, { role: 'user', content: text }]
  const res = await fetch(`${APPROVAL_BASE.replace(/\/$/, '')}/chat/orchestrate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CHAT_TOKEN ? { Authorization: `Bearer ${CHAT_TOKEN}` } : {}),
    },
    body: JSON.stringify({ messages }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>
    throw new Error(err.error ?? `Orchestrate stream ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: OrchestrateResult | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      if (!part.trim()) continue
      let eventType = 'message'
      let dataLine = ''
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        if (line.startsWith('data:')) dataLine = line.slice(5).trim()
      }
      if (!dataLine) continue

      try {
        const parsed = JSON.parse(dataLine) as Record<string, unknown>
        if (eventType === 'phase' && parsed.phase) {
          onPhase?.({
            phase: parsed.phase as OrchestratePhase,
            label: parsed.label as string | undefined,
            data: parsed,
          })
        }
        if (eventType === 'complete') {
          finalResult = parseOrchestratePayload(parsed)
          onPhase?.({ phase: 'done', label: '完成' })
        }
        if (eventType === 'error') {
          throw new Error((parsed.error as string) ?? 'Orchestrate failed')
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }

  if (!finalResult) return orchestrate(text, history)
  return finalResult
}

/** 透過 Orchestrator 發送訊息，回傳合成回覆 + 參與的 Agent 清單。 */
export async function orchestrate(text: string, history: History = []): Promise<OrchestrateResult> {
  if (!APPROVAL_BASE) {
    await new Promise((r) => setTimeout(r, 800))
    return {
      reply: `（示範模式）收到：${text}`,
      model: null,
      agents: [{ id: 'assistant', icon: '🧠', display: 'OneAI', reply: '（示範模式）', model: 'demo' }],
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

  const data = await res.json() as Record<string, unknown>
  return parseOrchestratePayload(data)
}

import { useEffect, useState, useCallback } from 'react'
import type { AgentInfo } from '../types'
import { fetchAgents } from '../lib/agents'

// ── 內建 AI Agent 定義（always-on 雲端 agent）────────────────────────────────
const BUILTIN: Array<{ id: string; icon: string; name: string; accentColor: string }> = [
  { id: 'meilan',          icon: '👑', name: '梅蘭 (營運長)',  accentColor: '#a78bfa' },
  { id: 'engineer',        icon: '💻', name: '工程師',         accentColor: '#22d3ee' },
  { id: 'pm',              icon: '📋', name: '專案主管',       accentColor: '#818cf8' },
  { id: 'analyst',         icon: '📊', name: '分析師',         accentColor: '#fb923c' },
  { id: 'coach',           icon: '🧘', name: '教練',           accentColor: '#4ade80' },
  { id: 'butler',          icon: '🫅', name: '管家',           accentColor: '#fbbf24' },
  { id: 'code_reviewer',   icon: '🔍', name: '程式審查',       accentColor: '#f472b6' },
  { id: 'security_auditor',icon: '🛡', name: '資安員',         accentColor: '#ef4444' },
  { id: 'researcher',      icon: '🌐', name: '研究員',         accentColor: '#34d399' },
]

type CardAgent = {
  id: string
  icon: string
  name: string
  accentColor: string
  type: 'builtin' | 'worker'
  status: 'active' | 'idle' | 'alert' | 'offline'
  subtitle: string
  online: boolean
}

function statusInfo(status: CardAgent['status']): { label: string; dot: string } {
  return {
    active:  { label: 'Active',  dot: '#22c55e' },
    idle:    { label: 'Idle',    dot: '#f59e0b' },
    alert:   { label: 'Alert',   dot: '#fbbf24' },
    offline: { label: 'Offline', dot: '#4b5563' },
  }[status]
}

// ── Agent 卡片 ────────────────────────────────────────────────────────────────
function AgentCard({ agent, onDispatch }: {
  agent: CardAgent
  onDispatch: (id: string) => void
}) {
  const si = statusInfo(agent.status)

  return (
    <div
      className="ag-card glass"
      style={{ borderTopColor: agent.accentColor }}
    >
      {/* 狀態點（右上角） */}
      <span
        className="ag-card-dot"
        style={{ background: si.dot, boxShadow: `0 0 6px ${si.dot}` }}
      />

      {/* 頭部：圖示 + 名稱 */}
      <div className="ag-card-head">
        <span className="ag-card-icon">{agent.icon}</span>
        <div>
          <p className="ag-card-name">{agent.name}</p>
          <p className="ag-card-sub" style={{ color: si.dot }}>{si.label}</p>
        </div>
      </div>

      {/* 副標題（task / subtitle） */}
      {agent.subtitle && (
        <p className="ag-card-task">{agent.subtitle}</p>
      )}

      {/* 操作按鈕 */}
      <div className="ag-card-actions">
        <button
          className="ag-action-btn"
          style={{ color: agent.accentColor }}
          onClick={() => onDispatch(agent.id)}
          title="派送任務"
          disabled={!agent.online && agent.type === 'worker'}
        >
          ▶
        </button>
        <button className="ag-action-btn" title="Agent 資訊">●</button>
        <button className="ag-action-btn" title="更多選項">⋮</button>
      </div>
    </div>
  )
}

// ── 主元件 ────────────────────────────────────────────────────────────────────
export default function AgentGrid() {
  const [workers, setWorkers] = useState<AgentInfo[]>([])
  const [lastPoll, setLastPoll] = useState(0)

  const poll = useCallback(() => {
    fetchAgents().then((list) => {
      setWorkers(list)
      setLastPoll(Date.now())
    })
  }, [])

  useEffect(() => {
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [poll])

  // 合併 built-in + worker agents
  const cards: CardAgent[] = [
    // 內建 AI agents 永遠在線（雲端 serverless）
    ...BUILTIN.map((b): CardAgent => ({
      ...b,
      type: 'builtin',
      status: 'active',
      subtitle: '雲端 · 隨時可用',
      online: true,
    })),
    // 實體 worker agents（有真實心跳）
    ...workers
      .filter((w) => !BUILTIN.some((b) => b.id === w.agent_id))  // 避免重複
      .map((w): CardAgent => ({
        id: w.agent_id,
        icon: '🖥',
        name: w.display || w.agent_id,
        accentColor: '#67e8f9',
        type: 'worker',
        status: !w.online ? 'offline' : w.status === 'running' ? 'active' : w.status === 'error' ? 'alert' : 'idle',
        subtitle: w.online
          ? (w.current_task ? w.current_task.slice(0, 40) : '待命中')
          : '離線 · 請啟動 worker.py',
        online: w.online,
      })),
  ]

  const onlineCount = cards.filter((c) => c.online).length
  const ago = lastPoll ? Math.round((Date.now() - lastPoll) / 1000) : null

  return (
    <div className="agent-grid-page">
      {/* 區塊標頭 */}
      <div className="ag-section-header">
        <span className="ag-section-title">Connected Agents</span>
        <span className="ag-section-meta">
          {onlineCount}/{cards.length} online
          {ago != null && <span className="ag-section-ago"> · {ago}s</span>}
        </span>
        <button className="ag-refresh-btn" onClick={poll} title="重新整理">↻</button>
      </div>

      {/* 卡片格子 */}
      <div className="ag-grid">
        {cards.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onDispatch={(id) => console.log('[AgentGrid] dispatch to', id)}
          />
        ))}
      </div>

      {/* 新增 agent 提示 */}
      <div className="ag-add-hint">
        在本機執行 <code>python hands/antigravity/worker.py</code> 即可接入新 Agent
      </div>
    </div>
  )
}

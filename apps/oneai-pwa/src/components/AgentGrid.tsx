import { useEffect, useState, useCallback } from 'react'
import type { AgentInfo } from '../types'
import { fetchAgents } from '../lib/agents'
import { useOneAI } from '../state/store'
import { dispatchTask, pollTaskOnce } from '../lib/task-client'

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

function AgentCard({ agent, onDispatch, dispatching }: {
  agent: CardAgent
  onDispatch: (agent: CardAgent) => void
  dispatching: boolean
}) {
  const si = statusInfo(agent.status)
  const showDispatch = agent.type === 'worker' && agent.online

  return (
    <div className="ag-card glass" style={{ borderTopColor: agent.accentColor }}>
      <span className="ag-card-dot" style={{ background: si.dot, boxShadow: `0 0 6px ${si.dot}` }} />
      <div className="ag-card-head">
        <span className="ag-card-icon">{agent.icon}</span>
        <div>
          <p className="ag-card-name">{agent.name}</p>
          <p className="ag-card-sub" style={{ color: si.dot }}>{si.label}</p>
        </div>
      </div>
      {agent.subtitle && <p className="ag-card-task">{agent.subtitle}</p>}
      <div className="ag-card-actions">
        {showDispatch ? (
          <button
            className="ag-action-btn"
            style={{ color: agent.accentColor }}
            onClick={() => onDispatch(agent)}
            title="派送 ping 測試"
            disabled={dispatching}
          >
            ▶
          </button>
        ) : (
          <span className="ag-action-btn ag-action-btn--muted" title={agent.type === 'builtin' ? '雲端 Agent 請在 AI 介面對話' : 'Worker 離線'}>—</span>
        )}
      </div>
    </div>
  )
}

export default function AgentGrid() {
  const [workers, setWorkers] = useState<AgentInfo[]>([])
  const [lastPoll, setLastPoll] = useState(0)
  const [dispatching, setDispatching] = useState(false)
  const requestTab = useOneAI((s) => s.requestTab)
  const pushActivity = useOneAI((s) => s.pushActivity)

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

  const handleDispatch = async (agent: CardAgent) => {
    if (agent.type === 'builtin') {
      requestTab('chat')
      pushActivity('info', `💬 請在 AI 介面與 ${agent.name} 對話（雲端 Agent 經 orchestrate 路由）`, {
        agentId: agent.id, agentIcon: agent.icon, agentDisplay: agent.name,
      })
      return
    }
    setDispatching(true)
    try {
      const taskId = await dispatchTask('shell', { cmd: `echo OneAI ping from ${agent.id}` })
      pushActivity('task', `▶ 已派送 ping 至 ${agent.name} [${taskId.slice(0, 8)}]`, {
        agentId: agent.id, agentIcon: agent.icon, agentDisplay: agent.name,
      })
      const data = await pollTaskOnce(taskId)
      if (data.status === 'done') {
        pushActivity('result', `✅ ${agent.name} 回應正常`, { agentId: agent.id, agentIcon: agent.icon, agentDisplay: agent.name })
      }
    } catch (e) {
      pushActivity('warning', `派送失敗：${(e as Error).message}`, { agentId: 'assistant', agentIcon: '⚠️', agentDisplay: 'OneAI' })
    } finally {
      setDispatching(false)
    }
  }

  const cards: CardAgent[] = [
    ...BUILTIN.map((b): CardAgent => ({
      ...b,
      type: 'builtin',
      status: 'active',
      subtitle: '雲端 · 在 AI 介面對話',
      online: true,
    })),
    ...workers
      .filter((w) => !BUILTIN.some((b) => b.id === w.agent_id))
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
      <div className="ag-section-header">
        <span className="ag-section-title">Connected Agents</span>
        <span className="ag-section-meta">
          {onlineCount}/{cards.length} online
          {ago != null && <span className="ag-section-ago"> · {ago}s</span>}
        </span>
        <button className="ag-refresh-btn" onClick={poll} title="重新整理">↻</button>
      </div>
      <div className="ag-grid">
        {cards.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onDispatch={handleDispatch}
            dispatching={dispatching}
          />
        ))}
      </div>
      <div className="ag-add-hint">
        在本機執行 <code>python hands/antigravity/worker.py</code> 即可接入新 Agent
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { AgentInfo, SystemStatus, ServiceInfo } from '../types'
import { fetchSystemStatus } from '../lib/agents'

// ── 服務顯示設定 ─────────────────────────────────────────────────────────────
const SERVICE_META: Record<string, { label: string; icon: string }> = {
  approval_svc: { label: 'Brain API',   icon: '🧠' },
  openrouter:   { label: 'OpenRouter',  icon: '🤖' },
  rag_svc:      { label: 'RAG / Vault', icon: '📚' },
  librechat:    { label: 'LibreChat',   icon: '💬' },
}

const STATUS_COLOR: Record<string, string> = {
  ok:           'var(--c-success, #22c55e)',
  configured:   'var(--c-success, #22c55e)',
  error:        'var(--c-warn, #f59e0b)',
  offline:      'var(--c-danger, #ef4444)',
  missing_key:  'var(--c-danger, #ef4444)',
  not_deployed: '#555',
  unknown:      '#555',
}

const STATUS_LABEL: Record<string, string> = {
  ok:           '正常',
  configured:   '已設定',
  error:        '錯誤',
  offline:      '離線',
  missing_key:  '缺少 Key',
  not_deployed: '未部署',
  unknown:      '未知',
}

const AGENT_STATUS_LABEL: Record<string, string> = {
  idle:    '待命',
  running: '執行中',
  error:   '錯誤',
}

const ORG_COLOR: Record<string, string> = {
  personal: '#7c3aed',
}

// ── 子元件 ───────────────────────────────────────────────────────────────────
function ServiceRow({ id, info }: { id: string; info: ServiceInfo }) {
  const meta   = SERVICE_META[id] ?? { label: id, icon: '⚙️' }
  const color  = STATUS_COLOR[info.status]  ?? '#555'
  const label  = STATUS_LABEL[info.status]  ?? info.status
  const ms     = info.latency_ms != null ? `${info.latency_ms}ms` : null

  return (
    <div className="svc-row">
      <span className="svc-icon">{meta.icon}</span>
      <span className="svc-name">{meta.label}</span>
      <span className="svc-badge" style={{ color, borderColor: color }}>
        {label}
        {ms && <span className="svc-ms">{ms}</span>}
      </span>
    </div>
  )
}

function AgentRow({ a }: { a: AgentInfo }) {
  const dotClass = !a.online ? 'agent-offline'
    : a.status === 'running'  ? 'agent-running'
    : a.status === 'error'    ? 'agent-error'
    : 'agent-idle'

  const dot = !a.online ? '○' : a.status === 'running' ? '◉' : '●'

  const taskText = a.online
    ? (a.current_task ? a.current_task.slice(0, 45) : AGENT_STATUS_LABEL[a.status] ?? a.status)
    : '離線'

  return (
    <div className={`agent-row ${dotClass}`}>
      <span className="agent-status-dot">{dot}</span>
      <span className="agent-name">{a.display || a.agent_id}</span>
      <span className="agent-task">{taskText}</span>
    </div>
  )
}

// ── 主元件 ───────────────────────────────────────────────────────────────────
export default function AgentPanel() {
  const [data,   setData]   = useState<SystemStatus | null>(null)
  const [open,   setOpen]   = useState(false)
  const [lastTs, setLastTs] = useState(0)

  useEffect(() => {
    const poll = () =>
      fetchSystemStatus().then((d) => {
        if (d) { setData(d); setLastTs(Date.now()) }
      })
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [])

  const agents = data?.agents ?? []
  const services = data?.services
  const onlineCount = agents.filter((a) => a.online).length

  // 整體健康：有任何服務 error/offline/missing_key → 警告
  const hasIssue = services
    ? Object.values(services).some((s) => ['error', 'offline', 'missing_key'].includes(s.status))
    : false

  const headerDotClass = hasIssue ? 'status-warn' : onlineCount > 0 ? 'status-ok' : 'status-off'

  // 依 org 分組
  const byOrg = agents.reduce<Record<string, AgentInfo[]>>((acc, a) => {
    const org = a.org || 'other';
    (acc[org] ??= []).push(a)
    return acc
  }, {})

  const ago = lastTs ? Math.round((Date.now() - lastTs) / 1000) : null

  return (
    <div className="agent-panel glass">
      {/* 摺疊觸發器 */}
      <button className="agent-panel-toggle" onClick={() => setOpen((v) => !v)}>
        <span className={`status-dot-sm ${headerDotClass}`} />
        <span className="panel-title">
          系統狀態
          {hasIssue && <span className="panel-warn-badge">!</span>}
        </span>
        <span className="panel-sub">
          Agents {onlineCount}/{agents.length || 0}
          {ago != null && <span className="panel-age"> · {ago}s</span>}
        </span>
        <span className="agent-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="panel-body">

          {/* ── 服務 API 狀態 ── */}
          <div className="panel-section">
            <span className="panel-section-title">服務 / API</span>
            {services
              ? Object.entries(services).map(([id, info]) => (
                  <ServiceRow key={id} id={id} info={info as ServiceInfo} />
                ))
              : <p className="agent-empty">載入中…</p>
            }
          </div>

          {/* ── Agent 清單 ── */}
          <div className="panel-section">
            <span className="panel-section-title">Agent</span>
            {agents.length === 0 ? (
              <p className="agent-empty">尚無 agent 回報心跳<br />啟動 worker.py 後即出現</p>
            ) : (
              Object.entries(byOrg).map(([org, list]) => (
                <div key={org} className="agent-org">
                  <span
                    className="agent-org-label"
                    style={{ borderColor: ORG_COLOR[org] ?? '#666' }}
                  >
                    {org}
                  </span>
                  {list.map((a) => <AgentRow key={a.agent_id} a={a} />)}
                </div>
              ))
            )}
          </div>

        </div>
      )}
    </div>
  )
}

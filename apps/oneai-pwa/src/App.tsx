import { useEffect, useState } from 'react'
import Orb from './components/Orb'
import ActivityFeed from './components/ActivityFeed'
import ApprovalCard from './components/ApprovalCard'
import ChatInput from './components/ChatInput'
import AgentGrid from './components/AgentGrid'
import AgentPanel from './components/AgentPanel'
import { BrainPanel } from './components/BrainPanel'
import { AgyPanel } from './components/AgyPanel'
import DevPanel from './components/DevPanel'
import { startHeartbeat } from './lib/heartbeat'
import { enablePush } from './lib/push'
import { useOneAI } from './state/store'

type Tab = 'chat' | 'agents' | 'memory' | 'settings'

const LABEL: Record<string, string> = {
  idle:      '待命',
  listening: '聆聽中',
  thinking:  '思考中',
  speaking:  '回應中',
  alert:     '等待授權',
  success:   '完成',
}

function shortModel(m: string | null): string {
  if (!m) return ''
  return (m.split('/').pop() ?? m)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

// ── 底部 Tab 按鈕 ─────────────────────────────────────────────────────────────
function TabBtn({
  icon, label, active, onClick,
}: {
  id?: Tab; icon: string; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      className={`tab-btn ${active ? 'tab-btn--active' : ''}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="tab-btn-icon">{icon}</span>
      <span className="tab-btn-label">{label}</span>
    </button>
  )
}

// ── 設定頁（簡版） ────────────────────────────────────────────────────────────
function SettingsTab({ onShowAgy }: { onShowAgy: () => void }) {
  const setPushEnabled = useOneAI((s) => s.setPushEnabled)

  return (
    <div className="settings-tab">
      <div className="settings-section">
        <p className="settings-title">系統控制</p>
        <button
          className="settings-row glass"
          onClick={async () => setPushEnabled(await enablePush())}
        >
          <span>🔔</span> 開啟手機推播通知
        </button>
        <button className="settings-row glass" onClick={onShowAgy}>
          <span>⚡</span> 直接控制桌機 Worker
        </button>
      </div>
      <div className="settings-section">
        <p className="settings-title">系統資訊</p>
        <AgentPanel />
        <div className="settings-info glass">
          <p>服務端點</p>
          <code>{import.meta.env.VITE_APPROVAL_BASE_URL ?? '未設定'}</code>
        </div>
      </div>
    </div>
  )
}

const APPROVAL_BASE = (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

function BrainHeaderBadge() {
  const [total, setTotal] = useState<number | null>(null)
  const [brainOk, setBrainOk] = useState(false)

  useEffect(() => {
    if (!APPROVAL_BASE) return
    const load = () => {
      fetch(`${APPROVAL_BASE}/brain/summary`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { total_memories?: number; status?: string } | null) => {
          if (!d) return
          setTotal(d.total_memories ?? 0)
          setBrainOk(d.status === 'ok')
        })
        .catch(() => {})
    }
    load()
    const t = window.setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  if (total === null) return null
  return (
    <span
      className={`header-brain ${brainOk ? 'header-brain--ok' : 'header-brain--warn'}`}
      title={brainOk ? `數位大腦在線 · ${total} 條記憶` : '記憶庫離線或未部署'}
    >
      🫀 {total}
    </span>
  )
}

// ── 主 App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [showAgy, setShowAgy] = useState(false)

  const status    = useOneAI((s) => s.status)
  const connected = useOneAI((s) => s.connected)
  const model     = useOneAI((s) => s.currentModel)
  const requestedTab = useOneAI((s) => s.requestedTab)
  const memoryHighlight = useOneAI((s) => s.memoryHighlight)
  const clearRequestedTab = useOneAI((s) => s.clearRequestedTab)

  useEffect(() => {
    const stopHeartbeat = startHeartbeat()
    return () => stopHeartbeat()
  }, [])

  useEffect(() => {
    if (requestedTab) {
      setTab(requestedTab)
      clearRequestedTab()
    }
  }, [requestedTab, clearRequestedTab])

  // 點 Agents tab 時暫時縮小 orb
  const orbSmall = tab !== 'chat'

  return (
    <div className="app">

      {/* ── Orb（背景，永遠存在）──────────────────────────── */}
      <div className={`orb-layer ${orbSmall ? 'orb-layer--small' : ''}`}>
        <Orb />
      </div>

      {/* ── UI 疊層 ────────────────────────────────────────── */}
      <div className="ui-layer">

        {/* 頂部 Header */}
        <header className="app-header glass">
          <button className="header-icon-btn" aria-label="選單">◈</button>
          <div className="header-center">
            <h1 className="header-title">ONEai</h1>
            <span
              className="header-status-dot"
              data-status={status}
              title={LABEL[status] ?? status}
            />
          </div>
          <div className="header-right">
            <BrainHeaderBadge />
            {model && <span className="header-model">{shortModel(model)}</span>}
            <span className={`header-conn ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? '●' : '○'}
            </span>
          </div>
        </header>

        {/* 內容區 */}
        <main className="app-main">

          {/* Chat Tab */}
          {tab === 'chat' && (
            <div className="tab-chat">
              <div className="tab-chat-feed">
                <ActivityFeed />
              </div>
              <div className="tab-chat-input">
                <ApprovalCard />
                <ChatInput />
              </div>
            </div>
          )}

          {/* Agents Tab */}
          {tab === 'agents' && (
            <div className="tab-scroll">
              <AgentGrid />
            </div>
          )}

          {/* Memory Tab */}
          {tab === 'memory' && (
            <div className="tab-scroll">
              <BrainPanel inline highlightQuery={memoryHighlight} onClose={() => setTab('chat')} />
            </div>
          )}

          {/* Settings Tab */}
          {tab === 'settings' && (
            <div className="tab-scroll">
              <SettingsTab onShowAgy={() => setShowAgy(true)} />
            </div>
          )}

        </main>

        {/* 底部 Tab Bar */}
        <nav className="bottom-nav glass">
          <TabBtn id="chat"     icon="◈"  label="AI 介面" active={tab === 'chat'}     onClick={() => setTab('chat')} />
          <TabBtn id="agents"   icon="⊞"  label="Agents"  active={tab === 'agents'}   onClick={() => setTab('agents')} />
          <TabBtn id="memory"   icon="🫀" label="記憶"    active={tab === 'memory'}   onClick={() => setTab('memory')} />
          <TabBtn id="settings" icon="⚙"  label="設定"    active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>

      </div>

      {/* 浮動面板（僅開發模式） */}
      {import.meta.env.DEV && <DevPanel />}
      {showAgy && <AgyPanel onClose={() => setShowAgy(false)} />}
    </div>
  )
}

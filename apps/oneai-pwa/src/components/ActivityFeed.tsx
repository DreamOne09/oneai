import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useOneAI } from '../state/store'
import type { ActivityItem } from '../types'

// AI 回覆超過此字數時可折疊
const COLLAPSE_THRESHOLD = 160

// Agent 顏色主題（agentId → CSS 顏色）
const AGENT_COLORS: Record<string, string> = {
  user:             '#67e8f9',
  assistant:        '#22d3ee',
  engineer:         '#38bdf8',
  pm:               '#a78bfa',
  coach:            '#4ade80',
  analyst:          '#fbbf24',
  researcher:       '#38bdf8',
  butler:           '#c084fc',
  code_reviewer:    '#60a5fa',
  security_auditor: '#f87171',
  orchestrator:     '#c084fc',
}
const defaultColor = '#67e8f9'

function agentColor(id?: string) {
  return AGENT_COLORS[id ?? 'assistant'] ?? defaultColor
}

function CouncilTranscriptBlock({ transcript, meta }: {
  transcript: import('../types').CouncilTranscriptRound[]
  meta?: import('../types').CouncilMeta
}) {
  const [open, setOpen] = useState(false)
  if (!transcript?.length) return null
  return (
    <div className="council-transcript">
      <button type="button" className="msg-expand" onClick={() => setOpen(v => !v)}>
        {open ? '收合議事錄 ↑' : `🏛️ 議事錄 ${transcript.length} 輪${meta ? ` · ${meta.participants?.length ?? ''} 人` : ''} ↓`}
      </button>
      {open && transcript.map(r => (
        <div key={`${r.round}-${r.phase}`} className="council-transcript-round">
          <div className="council-transcript-round-title">
            第 {r.round} 輪 · {r.phase === 'opening' ? '開宗明義' : '交叉辯論'}
          </div>
          {r.entries.map(e => (
            <div key={`${e.agent}-${r.round}`} className="council-transcript-entry">
              <span className="council-transcript-agent">{e.display}</span>
              <span className="council-transcript-text">{e.excerpt}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── 單則訊息泡泡 ──────────────────────────────────────────────────────────────
function MessageBubble({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false)
  const [showExperts, setShowExperts] = useState(false)
  const openMemoryTab = useOneAI((s) => s.openMemoryTab)
  const isUser = item.kind === 'user' || item.agentId === 'user'
  const isMemoryCard = item.kind === 'memory' && !!item.memoryQuery
  const isLong = item.text.length > COLLAPSE_THRESHOLD
  const displayText = isLong && !expanded ? item.text.slice(0, COLLAPSE_THRESHOLD) + '…' : item.text
  const color = agentColor(item.agentId)

  const openMemory = () => {
    if (item.memoryQuery) openMemoryTab(item.memoryQuery)
  }

  return (
    <motion.div
      className={`msg-row ${isUser ? 'msg-row--user' : 'msg-row--agent'}`}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      layout
    >
      {/* Agent 頭像（左側）*/}
      {!isUser && (
        <div className="msg-avatar" style={{ background: `${color}22`, borderColor: `${color}55` }}>
          <span>{item.agentIcon ?? '🧠'}</span>
        </div>
      )}

      <div className={`msg-content ${isUser ? 'msg-content--user' : ''}`}>
        {/* 名稱 + 時間 */}
        {!isUser && (
          <div className="msg-meta">
            <span className="msg-name" style={{ color }}>{item.agentDisplay ?? 'OneAI'}</span>
            {item.memoriesUsed ? (
              <button type="button" className="msg-memory msg-memory--link" onClick={openMemory} title="查看記憶庫">
                🧠 記憶 ×{item.memoriesUsed}
              </button>
            ) : null}
            {item.brainLearned ? (
              <span className="msg-learned">📝 已學習</span>
            ) : null}
            {item.orchestrateMode && item.orchestrateMode !== 'idle' && (
              <span className="msg-mode-badge">
                {item.orchestrateMode === 'fast' ? '⚡快徑'
                  : item.orchestrateMode === 'staff' ? '👥人事'
                    : item.orchestrateMode === 'council_high_stakes' ? '🏛️高風險'
                      : '🏛️議會'}
              </span>
            )}
            <span className="msg-time">
              {new Date(item.ts).toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        {/* 任務卡片（Cursor — 專案 + 狀態，不顯示 code） */}
        {item.taskMeta && (
          <div className="task-card glass">
            <div className="task-card-row">
              <span className="task-card-project">📁 {item.taskMeta.projectName}</span>
              <span className={`task-card-status status-${item.taskMeta.status}`}>
                {item.taskMeta.status}
              </span>
            </div>
            <div className="task-card-summary">{item.taskMeta.summary}</div>
            <div className="task-card-meta">
              {item.taskMeta.worker === 'cursor' ? 'Cursor IDE'
                : item.taskMeta.worker === 'cloud' ? 'Cloud GHA'
                  : '桌機 Worker'}
              {' · '}
              {item.taskMeta.taskId.slice(0, 8)}
            </div>
          </div>
        )}

        {/* 訊息泡泡（任務類只顯示結果摘要，不 repeat 卡片） */}
        {(!item.taskMeta || item.kind === 'result') && (
        <div
          className={`msg-bubble ${isUser ? 'msg-bubble--user' : `msg-bubble--agent kind-${item.kind}`}${isMemoryCard ? ' msg-bubble--memory-link' : ''}`}
          style={!isUser ? { borderLeftColor: `${color}66` } : undefined}
          onClick={isMemoryCard ? openMemory : undefined}
          onKeyDown={isMemoryCard ? (e) => e.key === 'Enter' && openMemory() : undefined}
          role={isMemoryCard ? 'button' : undefined}
          tabIndex={isMemoryCard ? 0 : undefined}
          title={isMemoryCard ? '點擊查看記憶庫' : undefined}
        >
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{displayText}</span>
          {isLong && (
            <button className="msg-expand" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收合 ↑' : '展開 ↓'}
            </button>
          )}
        </div>
        )}

        {!item.taskMeta && item.searchSources && item.searchSources.length > 0 && (
          <div className="msg-sources">
            {item.searchSources.map((s, i) => (
              <a
                key={`${s.url}-${i}`}
                className="source-link"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                🔗 {s.title.slice(0, 40)}{s.title.length > 40 ? '…' : ''}
              </a>
            ))}
          </div>
        )}

        {!item.taskMeta && item.councilTranscript && item.councilTranscript.length > 0 && (
          <CouncilTranscriptBlock transcript={item.councilTranscript} meta={item.councilMeta} />
        )}

        {!item.taskMeta && item.agentDetails && item.agentDetails.length > 0 && (
          <div className="msg-experts">
            <button type="button" className="msg-expand" onClick={() => setShowExperts(v => !v)}>
              {showExperts ? '收合專家 ↑' : `查看 ${item.agentDetails!.length} 位專家 ↓`}
            </button>
            {showExperts && item.agentDetails.map(a => (
              <div key={a.id} className="expert-snippet">
                <span className="expert-label">{a.icon} {a.display}</span>
                <span className="expert-text">{a.reply.slice(0, 200)}{a.reply.length > 200 ? '…' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* 用戶訊息時間（靠右）*/}
        {isUser && (
          <div className="msg-meta msg-meta--user">
            <span className="msg-time">
              {new Date(item.ts).toLocaleTimeString('zh-Hant', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* 用戶頭像（右側）*/}
      {isUser && (
        <div className="msg-avatar msg-avatar--user" style={{ background: '#22d3ee22', borderColor: '#22d3ee55' }}>
          <span>👤</span>
        </div>
      )}
    </motion.div>
  )
}

// 思考中動畫（顯示在最上方）
function ThinkingBubble({ text }: { text: string }) {
  return (
    <motion.div
      className="msg-row msg-row--agent"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <div className="msg-avatar" style={{ background: '#a78bfa22', borderColor: '#a78bfa55' }}>
        <span>🧠</span>
      </div>
      <div className="msg-content">
        <div className="msg-meta">
          <span className="msg-name" style={{ color: '#a78bfa' }}>OneAI</span>
        </div>
        <div className="msg-bubble msg-bubble--agent msg-bubble--thinking">
          <div className="feed-thinking-dots"><span /><span /><span /></div>
          {text && <span className="feed-thinking-text">{text}</span>}
        </div>
      </div>
    </motion.div>
  )
}

// ── Agent 篩選列 ────────────────────────────────────────────────────────────
function AgentFilterBar({ activeAgentIds }: { activeAgentIds: string[] }) {
  const hiddenAgentIds    = useOneAI((s) => s.hiddenAgentIds)
  const toggleAgentVisibility = useOneAI((s) => s.toggleAgentVisibility)

  if (activeAgentIds.length <= 1) return null  // 只有一個 agent 時不顯示篩選

  return (
    <div className="agent-filter-bar">
      {activeAgentIds.map((id) => {
        const hidden  = hiddenAgentIds.includes(id)
        const color   = agentColor(id)
        const ICONS: Record<string, string>   = { engineer: '💻', pm: '📊', coach: '🧘', analyst: '🔍', researcher: '🔍', butler: '🫀', code_reviewer: '🔎', security_auditor: '🛡️', assistant: '🧠', orchestrator: '🧠' }
        const LABELS: Record<string, string>  = { engineer: '工程師', pm: 'PM', coach: '教練', analyst: '分析師', researcher: '研究員', butler: '管家', code_reviewer: 'Code Review', security_auditor: '資安', assistant: 'OneAI', orchestrator: 'OneAI' }
        return (
          <button
            key={id}
            className={`filter-chip ${hidden ? 'filter-chip--hidden' : 'filter-chip--active'}`}
            style={hidden ? undefined : { borderColor: color, color }}
            onClick={() => toggleAgentVisibility(id)}
            title={hidden ? `顯示 ${LABELS[id] ?? id}` : `隱藏 ${LABELS[id] ?? id}`}
          >
            {ICONS[id] ?? '🤖'} {LABELS[id] ?? id}
          </button>
        )
      })}
    </div>
  )
}

// ── 主要 Feed ────────────────────────────────────────────────────────────────
export default function ActivityFeed() {
  const activities    = useOneAI((s) => s.activities)
  const pending       = useOneAI((s) => s.pendingMessage)
  const hiddenAgentIds = useOneAI((s) => s.hiddenAgentIds)

  // 計算此次對話中出現過的 agent（用於篩選列）
  const activeAgentIds = Array.from(
    new Set(activities.map((a) => a.agentId).filter((id): id is string => !!id && id !== 'user')),
  )

  // 過濾隱藏的 agent（用戶自己的訊息永遠顯示）
  const visible = activities
    .slice(0, 80)
    .filter((a) => a.agentId === 'user' || !hiddenAgentIds.includes(a.agentId ?? ''))

  return (
    <div className="feed">
      <AgentFilterBar activeAgentIds={activeAgentIds} />
      <div className="feed-messages">
        <AnimatePresence initial={false}>
          {pending !== null && (
            <ThinkingBubble key="__pending__" text={pending} />
          )}
          {visible.map((a) => (
            <MessageBubble key={a.id} item={a} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

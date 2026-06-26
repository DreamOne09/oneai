import { useOneAI } from '../state/store'
import type { AgentStatus } from '../types'

const LABEL: Record<AgentStatus, string> = {
  idle:      '待命',
  listening: '聆聽中',
  thinking:  '思考中',
  speaking:  '回應中',
  alert:     '等待授權',
  success:   '完成',
}

// 把 OpenRouter model ID 精簡成易讀名稱
function shortModel(m: string | null): string {
  if (!m) return ''
  // e.g. "google/gemini-2.5-flash" → "Gemini 2.5 Flash"
  const name = m.split('/').pop() ?? m
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d+\.\d+)/, ' $1')
    .trim()
}

export default function StatusBar() {
  const status = useOneAI((s) => s.status)
  const connected = useOneAI((s) => s.connected)
  const model = useOneAI((s) => s.currentModel)
  const orchestrateMode = useOneAI((s) => s.orchestrateMode)

  const modeBadge = orchestrateMode === 'fast' ? '⚡'
    : orchestrateMode === 'council' ? '🏛️'
      : orchestrateMode === 'council_high_stakes' ? '🏛️⚠'
        : orchestrateMode === 'staff' ? '👥'
          : null

  return (
    <div className="statusbar glass">
      <div className="brand">
        <span className="dot" data-status={status} />
        ONEAI 2.0
      </div>
      <div className="status-meta">
        <span className="status-label">{LABEL[status]}</span>
        {modeBadge && <span className="mode-badge" title="編排模式">{modeBadge}</span>}
        {model && <span className="model-badge">{shortModel(model)}</span>}
        <span className={connected ? 'link on' : 'link off'}>{connected ? '● 連線' : '○ 離線'}</span>
      </div>
    </div>
  )
}

import { useState, useCallback, useEffect } from 'react'

const APPROVAL_BASE = (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const CHAT_TOKEN = (import.meta.env.VITE_CHAT_TOKEN as string | undefined) ?? (import.meta.env.VITE_APPROVAL_TOKEN as string | undefined) ?? ''

interface Memory {
  id: string
  text: string
  score: number
  created_at: string | null
}

interface BrainSummary {
  status: string
  total_memories: number
}

function authHeader(): Record<string, string> {
  return CHAT_TOKEN ? { Authorization: `Bearer ${CHAT_TOKEN}` } : {}
}

async function fetchMemories(query: string): Promise<Memory[]> {
  const r = await fetch(`${APPROVAL_BASE}/brain/memories?q=${encodeURIComponent(query)}&limit=20`, {
    headers: authHeader(),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json() as { memories: Memory[] }
  return data.memories ?? []
}

async function fetchSummary(): Promise<BrainSummary> {
  const r = await fetch(`${APPROVAL_BASE}/brain/summary`)
  if (!r.ok) return { status: 'error', total_memories: 0 }
  return r.json() as Promise<BrainSummary>
}

async function saveMemory(text: string): Promise<void> {
  const r = await fetch(`${APPROVAL_BASE}/brain/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() } as Record<string, string>,
    body: JSON.stringify({ text }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error ?? `HTTP ${r.status}`)
  }
}

interface BrainPanelProps {
  onClose: () => void
}

export function BrainPanel({ onClose }: BrainPanelProps) {
  const [query, setQuery] = useState('孟一')
  const [memories, setMemories] = useState<Memory[]>([])
  const [summary, setSummary] = useState<BrainSummary | null>(null)
  const [newMemory, setNewMemory] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const [mems, sum] = await Promise.all([fetchMemories(q), fetchSummary()])
      setMemories(mems)
      setSummary(sum)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(query) }, [load, query])

  const handleSave = async () => {
    if (!newMemory.trim()) return
    setSaving(true)
    setError(null)
    try {
      await saveMemory(newMemory.trim())
      setSaved(true)
      setNewMemory('')
      setTimeout(() => setSaved(false), 2000)
      // 重新查詢
      await load(query)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const statusColor = summary?.status === 'ok' ? '#4ade80' : '#f87171'

  return (
    <div className="brain-panel-overlay" onClick={onClose}>
      <div className="brain-panel" onClick={e => e.stopPropagation()}>
        {/* 標題列 */}
        <div className="brain-panel-header">
          <span className="brain-panel-title">🫀 數位大腦 · 記憶庫</span>
          <div className="brain-panel-stats">
            {summary && (
              <>
                <span style={{ color: statusColor }}>●</span>
                <span>{summary.total_memories} 條記憶</span>
              </>
            )}
          </div>
          <button className="brain-panel-close" onClick={onClose}>✕</button>
        </div>

        {/* 搜尋列 */}
        <div className="brain-panel-search">
          <input
            className="brain-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋記憶（關鍵字）..."
            onKeyDown={e => e.key === 'Enter' && load(query)}
          />
          <button className="brain-btn" onClick={() => load(query)} disabled={loading}>
            {loading ? '…' : '搜尋'}
          </button>
        </div>

        {/* 錯誤提示 */}
        {error && <div className="brain-error">⚠ {error}</div>}

        {/* 記憶列表 */}
        <div className="brain-memories">
          {memories.length === 0 && !loading && (
            <div className="brain-empty">
              {summary?.status === 'not_deployed' ? 'RAG 服務未部署' : '查無記憶，試試其他關鍵字'}
            </div>
          )}
          {memories.map(m => (
            <div className="brain-memory-card" key={m.id}>
              <div className="brain-memory-text">{m.text}</div>
              <div className="brain-memory-meta">
                <span>相關度 {(m.score * 100).toFixed(0)}%</span>
                {m.created_at && <span>{new Date(m.created_at).toLocaleDateString('zh-TW')}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* 手動寫入記憶 */}
        <div className="brain-panel-footer">
          <div className="brain-add-label">✍ 手動告訴管家要記住的事</div>
          <textarea
            className="brain-textarea"
            value={newMemory}
            onChange={e => setNewMemory(e.target.value)}
            placeholder="例：我下週要飛曼谷，記得提醒行程..."
            rows={2}
          />
          <button
            className={`brain-btn brain-save-btn ${saved ? 'brain-btn-ok' : ''}`}
            onClick={handleSave}
            disabled={saving || !newMemory.trim()}
          >
            {saved ? '✓ 已記住' : saving ? '儲存中…' : '寫入記憶'}
          </button>
        </div>
      </div>
    </div>
  )
}

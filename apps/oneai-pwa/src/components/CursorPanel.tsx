/**
 * CursorPanel — 派送前確認：專案路徑 + 任務摘要（不顯示程式碼）
 */
import { useState, useEffect } from 'react'
import { getDefaultProject, getRecentProjects, projectName, rememberProject } from '../lib/cursor-projects'
import { fetchAgents } from '../lib/agents'

export interface CursorDispatchPayload {
  cwd: string
  projectName: string
  summary: string
}

interface CursorPanelProps {
  taskSummary: string
  onClose: () => void
  onConfirm: (payload: CursorDispatchPayload) => void
  busy?: boolean
}

export function CursorPanel({ taskSummary, onClose, onConfirm, busy }: CursorPanelProps) {
  const [cwd, setCwd] = useState(getDefaultProject())
  const recent = getRecentProjects()
  const [cursorOnline, setCursorOnline] = useState<boolean | null>(null)

  useEffect(() => {
    fetchAgents().then(list => {
      const cw = list.find(a => a.agent_id.includes('cursor'))
      setCursorOnline(cw?.online ?? false)
    })
  }, [])

  const confirm = () => {
    const path = cwd.trim() || getDefaultProject()
    rememberProject(path)
    onConfirm({ cwd: path, projectName: projectName(path), summary: taskSummary })
  }

  return (
    <div className="brain-panel-overlay" onClick={onClose}>
      <div className="brain-panel cursor-panel" onClick={e => e.stopPropagation()}>
        <div className="brain-panel-header">
          <span className="brain-panel-title">💻 Cursor 專案</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>確認後送到桌機 Cursor IDE</span>
          <button type="button" className="brain-panel-close" onClick={onClose}>✕</button>
        </div>

        <div className="cursor-panel-body">
          <div className="cursor-field">
            <label className="cursor-label">進行中專案（repo 資料夾）</label>
            <input
              className="brain-input cursor-path-input"
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              placeholder="例：empty-window 或完整路徑"
              disabled={busy}
            />
            <p className="cursor-hint">
              桌機 <code>cursor_worker.py</code> 會在此目錄開啟 Agent。
              本機預設由 <code>CURSOR_AGENT_CWD</code> 決定。
            </p>
          </div>

          {recent.length > 0 && (
            <div className="cursor-recent">
              <span className="cursor-label">最近專案</span>
              <div className="cursor-recent-chips">
                {recent.map(p => (
                  <button
                    key={p}
                    type="button"
                    className="chip glass"
                    disabled={busy}
                    onClick={() => setCwd(p)}
                  >
                    📁 {projectName(p)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cursor-field">
            <label className="cursor-label">這次要做什麼（摘要）</label>
            <div className="cursor-summary glass">{taskSummary || '（無摘要）'}</div>
            <p className="cursor-hint">程式碼在桌機 Cursor 執行，手機不顯示 code。</p>
          </div>

          <div className="cursor-status-row glass">
            <span>Cursor Worker</span>
            <span className={cursorOnline ? 'cursor-dot--on' : 'cursor-dot--off'}>
              {cursorOnline === null ? '檢查中…' : cursorOnline ? '● 在線' : '○ 離線 — 請啟動 cursor_worker.py'}
            </span>
          </div>
        </div>

        <div className="cursor-panel-actions">
          <button type="button" className="brain-btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="brain-btn cursor-confirm-btn" onClick={confirm} disabled={busy}>
            {busy ? '派送中…' : '確認派送 → Cursor'}
          </button>
        </div>
      </div>
    </div>
  )
}

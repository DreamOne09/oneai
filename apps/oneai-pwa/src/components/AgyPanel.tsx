/**
 * AgyPanel — 直接派送 Shell 任務給本機 agy worker
 *
 * 讓執行長可以從 PWA 手機直接控制桌機：
 *  - 輸入任意 shell 命令 → 派送給 worker.py → 顯示執行結果
 *  - 常用快捷命令（一鍵派送）
 */
import { useState } from 'react'

const APPROVAL_BASE = (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const APPROVAL_TOKEN = import.meta.env.VITE_APPROVAL_TOKEN as string | undefined

interface TaskResult {
  status: string
  result?: { summary?: string; stdout_tail?: string; stderr_tail?: string }
}

async function dispatchShell(cmd: string): Promise<string> {
  const r = await fetch(`${APPROVAL_BASE}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(APPROVAL_TOKEN ? { Authorization: `Bearer ${APPROVAL_TOKEN}` } : {}),
    },
    body: JSON.stringify({ type: 'shell', payload: { cmd } }),
  })
  if (!r.ok) throw new Error(`dispatch failed: ${r.status}`)
  const d = await r.json() as { task_id?: string; id?: string }
  return d.task_id ?? d.id ?? ''
}

async function pollTaskOnce(taskId: string): Promise<TaskResult> {
  const r = await fetch(`${APPROVAL_BASE}/tasks/${taskId}`, {
    headers: APPROVAL_TOKEN ? { Authorization: `Bearer ${APPROVAL_TOKEN}` } : {},
  })
  if (!r.ok) throw new Error(`poll failed: ${r.status}`)
  return r.json() as Promise<TaskResult>
}

const QUICK_COMMANDS = [
  { label: '📋 系統資訊', cmd: 'systeminfo | findstr /B /C:"OS" /C:"Total Physical"' },
  { label: '💿 磁碟使用', cmd: 'wmic logicaldisk get size,freespace,caption' },
  { label: '🔍 Worker 狀態', cmd: 'tasklist | findstr python' },
  { label: '📁 下載資料夾', cmd: 'dir "%USERPROFILE%\\Downloads" /o-d /tc' },
  { label: '🌐 網路連線', cmd: 'ping -n 1 google.com' },
]

interface AgyPanelProps {
  onClose: () => void
}

export function AgyPanel({ onClose }: AgyPanelProps) {
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<{ taskId: string; status: string; result: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (command: string) => {
    if (!command.trim() || running) return
    setRunning(true)
    setError(null)
    setOutput(null)

    try {
      const taskId = await dispatchShell(command.trim())
      setOutput({ taskId, status: 'queued', result: '' })

      // 輪詢 90 秒
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000))
        const data = await pollTaskOnce(taskId)
        const result = data.result?.stdout_tail ?? data.result?.summary ?? ''
        const errTail = data.result?.stderr_tail ?? ''
        setOutput({ taskId, status: data.status ?? 'running', result: result || errTail })
        if (data.status === 'done' || data.status === 'error' || data.status === 'rejected') break
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const statusColor = (s: string) => {
    if (s === 'done') return '#4ade80'
    if (s === 'error' || s === 'rejected') return '#f87171'
    return 'var(--cyan-soft)'
  }

  return (
    <div className="brain-panel-overlay" onClick={onClose}>
      <div className="brain-panel" onClick={e => e.stopPropagation()}>
        <div className="brain-panel-header">
          <span className="brain-panel-title">⚡ 桌機控制 · agy</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>直接在你電腦執行命令</span>
          <button className="brain-panel-close" onClick={onClose}>✕</button>
        </div>

        {/* 快捷命令 */}
        <div style={{ padding: '10px 16px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_COMMANDS.map(qc => (
            <button
              key={qc.label}
              className="brain-btn"
              style={{ fontSize: 11, padding: '5px 10px' }}
              onClick={() => run(qc.cmd)}
              disabled={running}
            >
              {qc.label}
            </button>
          ))}
        </div>

        {/* 自訂指令輸入 */}
        <div className="brain-panel-search">
          <input
            className="brain-input"
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            placeholder="輸入任意 shell 命令..."
            onKeyDown={e => e.key === 'Enter' && run(cmd)}
            disabled={running}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
          <button
            className="brain-btn"
            onClick={() => run(cmd)}
            disabled={running || !cmd.trim()}
          >
            {running ? '執行中…' : '執行'}
          </button>
        </div>

        {/* 錯誤 */}
        {error && <div className="brain-error">⚠ {error}</div>}

        {/* 輸出結果 */}
        {output && (
          <div className="brain-memories" style={{ padding: '8px 16px' }}>
            <div className="brain-memory-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  任務 {output.taskId.slice(0, 12)}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(output.status) }}>
                  {output.status}
                </span>
              </div>
              {output.result
                ? <pre className="brain-memory-text" style={{ fontFamily: 'monospace', fontSize: 12, maxHeight: 240, overflow: 'auto' }}>{output.result}</pre>
                : <div className="brain-empty" style={{ padding: '12px 0', fontSize: 12 }}>等待 agy worker 回應…（確認桌機 worker.py 正在執行）</div>
              }
            </div>
          </div>
        )}

        <div style={{ padding: '8px 16px 16px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
          ⚠ 命令直接在你的 Windows 桌機執行。請確認 agy worker.py 正在執行。
        </div>
      </div>
    </div>
  )
}

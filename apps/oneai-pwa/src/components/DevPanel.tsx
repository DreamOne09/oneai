import { useState } from 'react'
import { useOneAI } from '../state/store'
import type { AgentStatus } from '../types'

const STATES: AgentStatus[] = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'success']

// v0 示範面板:後端未部署時,手動切狀態 / 模擬審核,展示會呼吸的核心。
export default function DevPanel() {
  const [open, setOpen] = useState(false)
  const setStatus = useOneAI((s) => s.setStatus)
  const addApproval = useOneAI((s) => s.addApproval)
  const pushActivity = useOneAI((s) => s.pushActivity)

  return (
    <div className={`devpanel ${open ? 'open' : ''}`}>
      <button className="dev-toggle" onClick={() => setOpen((o) => !o)} aria-label="示範面板">
        ✦
      </button>
      {open && (
        <div className="dev-body glass">
          <div className="dev-row">
            {STATES.map((s) => (
              <button key={s} onClick={() => setStatus(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="dev-row">
            <button
              onClick={() =>
                addApproval({
                  id: crypto.randomUUID(),
                  action: 'send_email',
                  summary: '寄信給客戶 王先生,主旨:報價更新',
                  createdAt: Date.now(),
                  timeoutSec: 1800,
                })
              }
            >
              模擬審核
            </button>
            <button onClick={() => pushActivity('info', '測試通知 ' + new Date().toLocaleTimeString())}>
              模擬通知
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

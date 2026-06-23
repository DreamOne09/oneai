/** 聊天區上方 — 進行中 Cursor 任務 */
import { useOneAI } from '../state/store'

const STATUS_LABEL: Record<string, string> = {
  queued: '排隊中',
  running: '執行中',
  done: '完成',
  error: '失敗',
  timeout: '逾時',
  rejected: '拒絕',
}

export function CursorJobsBar() {
  const jobs = useOneAI(s => s.cursorJobs)
  const active = jobs.filter(j => j.status === 'queued' || j.status === 'running')
  if (!active.length) return null

  return (
    <div className="cursor-jobs-bar glass">
      <span className="cursor-jobs-title">進行中</span>
      {active.map(j => (
        <div key={j.taskId} className="cursor-job-pill">
          <span className="cursor-job-project">📁 {j.projectName}</span>
          <span className="cursor-job-summary">{j.summary.slice(0, 48)}{j.summary.length > 48 ? '…' : ''}</span>
          <span className={`cursor-job-status status-${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
        </div>
      ))}
    </div>
  )
}

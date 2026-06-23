/** 設定頁 — Cursor 工作區 + 最近任務 */
import { useEffect, useState } from 'react'
import { getDefaultProject, getRecentProjects, projectName, rememberProject, setDefaultProject } from '../lib/cursor-projects'
import { fetchAgents } from '../lib/agents'
import { useOneAI } from '../state/store'
import type { AgentInfo } from '../types'

export function CursorHubSection() {
  const [cwd, setCwd] = useState(getDefaultProject())
  const [cursorAgent, setCursorAgent] = useState<AgentInfo | null>(null)
  const jobs = useOneAI(s => s.cursorJobs)

  useEffect(() => {
    fetchAgents().then(list => {
      setCursorAgent(list.find(a => a.agent_id.includes('cursor')) ?? null)
    })
    const id = window.setInterval(() => {
      fetchAgents().then(list => {
        setCursorAgent(list.find(a => a.agent_id.includes('cursor')) ?? null)
      })
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const save = () => {
    rememberProject(cwd)
    setDefaultProject(cwd)
  }

  return (
    <div className="settings-section">
      <p className="settings-title">💻 Cursor 工作區</p>
      <div className="cursor-hub glass">
        <label className="cursor-label">預設 repo / 專案名</label>
        <input
          className="brain-input cursor-path-input"
          value={cwd}
          onChange={e => setCwd(e.target.value)}
          onBlur={save}
        />
        <p className="cursor-hint">
          Worker：{cursorAgent?.online ? '● 在線' : '○ 離線'}
          {cursorAgent?.workspace_cwd && (
            <> · 桌機目錄 <code>{cursorAgent.workspace_cwd}</code></>
          )}
        </p>
        {cursorAgent?.current_task && (
          <p className="cursor-hint">現在：{cursorAgent.current_task}</p>
        )}
        {getRecentProjects().length > 0 && (
          <p className="cursor-hint">最近：{getRecentProjects().map(projectName).join(' · ')}</p>
        )}
        {jobs.length > 0 && (
          <ul className="cursor-hub-jobs">
            {jobs.slice(0, 5).map(j => (
              <li key={j.taskId}>
                <strong>{j.projectName}</strong> — {j.summary.slice(0, 40)}…
                <span className={`cursor-job-status status-${j.status}`}>{j.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="cursor-hint" style={{ marginTop: 8 }}>
          常駐：<code>python hands/cursor-agent/cursor_worker.py</code>
        </p>
      </div>
    </div>
  )
}

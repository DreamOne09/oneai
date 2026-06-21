import { useEffect, useState } from 'react'
import Orb from './components/Orb'
import StatusBar from './components/StatusBar'
import ActivityFeed from './components/ActivityFeed'
import ApprovalCard from './components/ApprovalCard'
import ChatInput from './components/ChatInput'
import AgentPanel from './components/AgentPanel'
import DevPanel from './components/DevPanel'
import { BrainPanel } from './components/BrainPanel'
import { AgyPanel } from './components/AgyPanel'
import { connectNtfy } from './lib/ntfy'
import { startHeartbeat } from './lib/heartbeat'
import { enablePush } from './lib/push'
import { useOneAI } from './state/store'

export default function App() {
  const setPushEnabled = useOneAI((s) => s.setPushEnabled)
  const [showBrain, setShowBrain] = useState(false)
  const [showAgy, setShowAgy] = useState(false)

  useEffect(() => {
    const stopHeartbeat = startHeartbeat()
    const stopNtfy = connectNtfy()
    return () => {
      stopHeartbeat()
      stopNtfy()
    }
  }, [])

  return (
    <div className="app">
      <div className="orb-layer">
        <Orb />
      </div>

      <div className="ui-layer">
        <StatusBar />
        <AgentPanel />

        <div className="center">
          <ActivityFeed />
        </div>

        <div className="bottom">
          <ApprovalCard />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="enable-push glass"
              onClick={async () => setPushEnabled(await enablePush())}
            >
              開啟手機推播
            </button>
            <button
              className="glass"
              style={{ padding: '8px 14px', borderRadius: 12, fontSize: 14, cursor: 'pointer', border: '1px solid rgba(103,232,249,0.2)', background: 'rgba(34,211,238,0.08)', color: 'var(--cyan-soft)', flexShrink: 0 }}
              onClick={() => setShowBrain(true)}
              title="數位大腦 · 記憶庫"
            >
              🫀 大腦
            </button>
            <button
              className="glass"
              style={{ padding: '8px 14px', borderRadius: 12, fontSize: 14, cursor: 'pointer', border: '1px solid rgba(250,204,21,0.25)', background: 'rgba(250,204,21,0.08)', color: '#fde68a', flexShrink: 0 }}
              onClick={() => setShowAgy(true)}
              title="直接控制桌機 agy"
            >
              ⚡ 桌機
            </button>
          </div>
          <ChatInput />
        </div>
      </div>

      <DevPanel />
      {showBrain && <BrainPanel onClose={() => setShowBrain(false)} />}
      {showAgy && <AgyPanel onClose={() => setShowAgy(false)} />}
    </div>
  )
}

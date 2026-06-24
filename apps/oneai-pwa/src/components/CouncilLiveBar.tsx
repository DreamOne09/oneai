import { useOneAI } from '../state/store'

const MODE_LABEL: Record<string, string> = {
  idle: '',
  fast: '⚡ 快徑',
  council: '🏛️ 議會',
  council_high_stakes: '🏛️ 高風險議會',
  staff: '👥 人事',
}

export default function CouncilLiveBar() {
  const live = useOneAI((s) => s.councilLive)

  if (!live?.active) return null

  const modeLabel = MODE_LABEL[live.mode] ?? live.mode
  const phaseLabel = live.phaseLabel ?? live.phase ?? '進行中'

  return (
    <div className="council-live glass" role="status" aria-live="polite">
      <div className="council-live-row">
        <span className="council-live-mode">{modeLabel}</span>
        {live.squadDisplay && (
          <span className="council-live-squad">{live.squadDisplay}</span>
        )}
        <span className="council-live-phase">{phaseLabel}</span>
      </div>
      {live.maxRounds > 0 && (
        <div className="council-live-rounds">
          辯論 {live.round}/{live.maxRounds} 輪
          {live.participants.length > 0 && (
            <span className="council-live-count"> · {live.participants.length} 位議員</span>
          )}
        </div>
      )}
      {live.participants.length > 0 && (
        <div className="council-live-agents">
          {live.participants.map((p) => (
            <span
              key={p.id}
              className={`council-agent-chip ${live.lastSpeaker === p.id ? 'council-agent-chip--speaking' : ''}`}
              title={p.display}
            >
              {p.icon} {p.display}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

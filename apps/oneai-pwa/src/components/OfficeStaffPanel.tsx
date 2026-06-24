import { useEffect, useState } from 'react'
import { fetchStaffRoster, type StaffMember } from '../lib/staff-client'

const MAX_STAFF = 36

export default function OfficeStaffPanel() {
  const [roster, setRoster] = useState<StaffMember[]>([])
  const [disabled, setDisabled] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const data = await fetchStaffRoster()
      if (cancelled) return
      setRoster(data?.staff ?? [])
      setDisabled(data?.disabled ?? [])
      setLoading(false)
    }
    load()
    const t = window.setInterval(load, 45_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  return (
    <div className="office-staff glass">
      <div className="office-staff-header">
        <h2 className="office-staff-title">數位辦公室編制</h2>
        <span className="office-staff-count">{roster.length}/{MAX_STAFF}</span>
      </div>
      <p className="office-staff-hint">
        對梅蘭說「列出編制」「新增議員…」可人事異動。單次議會最多 6 人同時辯論（2–3 輪）。
      </p>
      {loading && roster.length === 0 ? (
        <p className="agent-empty">載入編制中…</p>
      ) : (
        <div className="office-staff-grid">
          {roster.map((m) => (
            <div key={m.id} className={`office-staff-card ${m.custom ? 'office-staff-card--custom' : ''}`}>
              <span className="office-staff-icon">{m.icon}</span>
              <div className="office-staff-meta">
                <span className="office-staff-name">{m.display}</span>
                <code className="office-staff-id">{m.id}</code>
                {m.description && (
                  <span className="office-staff-desc">{m.description.slice(0, 72)}{m.description.length > 72 ? '…' : ''}</span>
                )}
              </div>
              <span className="office-staff-badge">{m.custom ? '自訂' : '常駐'}</span>
            </div>
          ))}
        </div>
      )}
      {disabled.length > 0 && (
        <p className="office-staff-disabled">⏸ 已停用：{disabled.join('、')}</p>
      )}
    </div>
  )
}

// Multi-Agent 與系統狀態輪詢：從 approval-svc 取得服務 + agent 心跳狀態。
import type { AgentInfo, SystemStatus } from '../types'

const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined
const BASE = () => APPROVAL_BASE?.replace(/\/$/, '') ?? ''

export async function fetchAgents(): Promise<AgentInfo[]> {
  if (!APPROVAL_BASE) return []
  try {
    const res = await fetch(`${BASE()}/agents/status`, { cache: 'no-store' })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function fetchSystemStatus(): Promise<SystemStatus | null> {
  if (!APPROVAL_BASE) return null
  try {
    const res = await fetch(`${BASE()}/system/status`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

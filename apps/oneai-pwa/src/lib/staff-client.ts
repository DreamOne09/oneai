/** 辦公室編制 — GET /agents/staff */
const BASE = () => (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const TOKEN = () => (import.meta.env.VITE_CHAT_TOKEN as string | undefined)
  ?? (import.meta.env.VITE_APPROVAL_TOKEN as string | undefined)

export interface StaffMember {
  id: string
  display: string
  icon: string
  description: string
  model: string | null
  custom: boolean
  org: string
  trust: string
}

export interface StaffRoster {
  staff: StaffMember[]
  disabled: string[]
  updated_at: string | null
}

export async function fetchStaffRoster(): Promise<StaffRoster | null> {
  if (!BASE()) return null
  try {
    const res = await fetch(`${BASE()}/agents/staff`, {
      cache: 'no-store',
      headers: TOKEN() ? { Authorization: `Bearer ${TOKEN()}` } : {},
    })
    if (!res.ok) return null
    return await res.json() as StaffRoster
  } catch {
    return null
  }
}

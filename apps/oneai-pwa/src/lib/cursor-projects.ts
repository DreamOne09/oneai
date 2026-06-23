/** Cursor 工作目錄 — 本機 sessionStorage，對齊人類「我在哪個專案」思維 */

const RECENT_KEY = 'oneai-cursor-recent'
const DEFAULT_KEY = 'oneai-cursor-default-cwd'

export function projectName(cwd: string): string {
  const norm = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] || norm || '專案'
}

export function getDefaultProject(): string {
  const fromEnv = (import.meta.env.VITE_CURSOR_DEFAULT_CWD as string | undefined)?.trim()
  if (fromEnv) return fromEnv
  try {
    const saved = localStorage.getItem(DEFAULT_KEY)
    if (saved) return saved
  } catch { /* ignore */ }
  return 'empty-window'
}

export function setDefaultProject(cwd: string): void {
  try {
    localStorage.setItem(DEFAULT_KEY, cwd.trim())
  } catch { /* ignore */ }
}

export function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as string[]
    return Array.isArray(list) ? list.slice(0, 6) : []
  } catch {
    return []
  }
}

export function rememberProject(cwd: string): void {
  const v = cwd.trim()
  if (!v) return
  const list = [v, ...getRecentProjects().filter(p => p !== v)].slice(0, 6)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    localStorage.setItem(DEFAULT_KEY, v)
  } catch { /* ignore */ }
}

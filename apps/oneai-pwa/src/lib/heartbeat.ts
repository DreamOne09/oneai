// 連線心跳:以審核服務(Tier-0 守門,常駐)的公開 /health 當「線上」判準。
// 我們改用 Web Push 取代 ntfy SSE,故連線狀態不再綁 ntfy,而綁實際依賴的後端可達性。
// /health 不含密鑰、可公開呼叫,故前端輪詢安全(切勿在前端持有 APPROVAL_TOKEN)。
import { useOneAI } from '../state/store'

const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined
const INTERVAL_MS = 15000
const TIMEOUT_MS = 8000

/** 啟動心跳;依後端可達性更新 connected。回傳停止函式。 */
export function startHeartbeat(): () => void {
  if (!APPROVAL_BASE) {
    // 無後端設定(示範/離線模式):維持離線顯示。
    useOneAI.getState().setConnected(false)
    return () => {}
  }

  const base = APPROVAL_BASE.replace(/\/$/, '')
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const ping = async () => {
    if (stopped) return
    // 裝置本身離線就不必打 API,直接標記離線。
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      useOneAI.getState().setConnected(false)
    } else {
      try {
        const ctrl = new AbortController()
        const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
        const res = await fetch(`${base}/health`, { signal: ctrl.signal, cache: 'no-store' })
        clearTimeout(to)
        useOneAI.getState().setConnected(res.ok)
      } catch {
        useOneAI.getState().setConnected(false)
      }
    }
    if (!stopped) timer = setTimeout(ping, INTERVAL_MS)
  }

  // 裝置上/下線事件 → 立即重判,避免等下一輪。
  const onOnline = () => { void ping() }
  const onOffline = () => useOneAI.getState().setConnected(false)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }

  void ping()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }
}

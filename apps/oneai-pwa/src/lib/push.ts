// Web Push 訂閱:向 service worker 註冊 PushManager,VAPID 公鑰來自 env。
// 訂閱端點送到審核服務後端儲存,之後由 ntfy / 後端發 Web Push。

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined

export async function enablePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (!VAPID_PUBLIC) {
    console.warn('[push] 缺少 VITE_VAPID_PUBLIC_KEY,跳過 Web Push 訂閱')
    return false
  }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return false

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // 現代瀏覽器接受 base64url 字串形式的 VAPID 公鑰
      applicationServerKey: VAPID_PUBLIC,
    }))

  if (APPROVAL_BASE) {
    try {
      await fetch(`${APPROVAL_BASE.replace(/\/$/, '')}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      })
    } catch (e) {
      console.warn('[push] 訂閱回報後端失敗', e)
    }
  }
  return true
}

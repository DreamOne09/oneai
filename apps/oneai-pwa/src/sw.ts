/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

declare const self: ServiceWorkerGlobalScope

// 部署新版本後立即接管，不等舊分頁關閉
self.skipWaiting()
clientsClaim()

// vite-plugin-pwa (injectManifest) 會把預快取清單注入此處
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined

interface PushPayload {
  title?: string
  body?: string
  detail?: string // 原始參數(實際要執行的指令),防混淆 — 直接顯示給使用者
  tag?: string
  url?: string
  approvalId?: string
  actionToken?: string
  requireApproval?: boolean
}

// DOM 與 WebWorker lib 的 NotificationOptions 不含 actions,這裡自行擴充
interface NotifAction {
  action: string
  title: string
  icon?: string
}
type ExtNotificationOptions = NotificationOptions & { actions?: NotifAction[] }

self.addEventListener('push', (event: PushEvent) => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }

  const isApproval = !!data.requireApproval && !!data.approvalId
  const actions: NotifAction[] = isApproval
    ? [
        { action: `approve:${data.approvalId}`, title: '允許' },
        { action: `reject:${data.approvalId}`, title: '拒絕' },
      ]
    : []

  // 招2 防操弄:審核通知直接顯示「真正要執行的原始參數」,而非僅摘要
  const body = data.detail ? `${data.body ?? ''}\n▶ ${data.detail}`.trim() : data.body ?? ''
  const options: ExtNotificationOptions = {
    body,
    tag: data.tag ?? data.approvalId ?? 'oneai',
    icon: '/icon.svg',
    badge: '/icon.svg',
    requireInteraction: isApproval,
    data,
    actions,
  }

  event.waitUntil(self.registration.showNotification(data.title ?? 'OneAI', options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const action = event.action
  const data = (event.notification.data ?? {}) as PushPayload

  // 通知上的 Approve / Reject 按鈕:直接打審核服務(夾帶 actionToken)
  if (action.startsWith('approve:') || action.startsWith('reject:')) {
    const [decision, id] = action.split(':')
    if (APPROVAL_BASE && id) {
      const q = data.actionToken ? `?t=${encodeURIComponent(data.actionToken)}` : ''
      event.waitUntil(
        fetch(`${APPROVAL_BASE.replace(/\/$/, '')}/${decision}/${id}${q}`, { method: 'POST' }).catch(
          () => undefined
        )
      )
    }
    return
  }

  // 一般點擊:聚焦或開啟 App
  const url = data.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return (c as WindowClient).focus()
      }
      return self.clients.openWindow(url)
    })
  )
})

// Web Push 發送 (VAPID)。供 App 關閉時的 OS 級推播 (與 ntfy 推播並行/備援)。
import webpush from 'web-push'
import { store } from './store.js'

const PUB = process.env.VAPID_PUBLIC_KEY
const PRIV = process.env.VAPID_PRIVATE_KEY
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

let ready = false
if (PUB && PRIV) {
  webpush.setVapidDetails(SUBJECT, PUB, PRIV)
  ready = true
} else {
  console.warn('[push] 未設定 VAPID 金鑰,Web Push 停用 (僅靠 ntfy)')
}

export async function sendPush(payload) {
  if (!ready) return
  const subs = store.listSubscriptions()
  await Promise.all(
    subs.map((sub) =>
      webpush.sendNotification(sub, JSON.stringify(payload)).catch((err) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) store.removeSubscription(sub.endpoint)
        else console.warn('[push] 發送失敗', err?.statusCode)
      })
    )
  )
}

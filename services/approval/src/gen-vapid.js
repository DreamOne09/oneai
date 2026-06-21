// 產生 VAPID 金鑰對。把 publicKey 放前端 VITE_VAPID_PUBLIC_KEY,
// publicKey/privateKey 放後端 (.env / Zeabur env)。
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey)
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey)

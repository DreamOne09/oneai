// 發布通知到自架 ntfy。審核訊息帶 Approve/Reject 的 http action 按鈕,
// 同時把 Approval 物件以 JSON 放在 message,供 PWA SSE 解析成審核卡片。

const BASE = process.env.NTFY_BASE_URL
const TOKEN = process.env.NTFY_TOKEN
const TOPIC_APPROVALS = process.env.NTFY_TOPIC_APPROVALS || 'limengyi-approvals'
const TOPIC_NOTIFY = process.env.NTFY_TOPIC_NOTIFY || 'limengyi-notify'
const APPROVAL_BASE = process.env.APPROVAL_BASE_URL || ''

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
}

/** 發布一般通知 */
export async function notify(title, body, tags = []) {
  if (!BASE) return
  await fetch(`${BASE.replace(/\/$/, '')}/${TOPIC_NOTIFY}`, {
    method: 'POST',
    headers: { ...authHeaders(), Title: encodeHeader(title), Tags: tags.join(',') },
    body,
  }).catch((e) => console.warn('[ntfy] notify 失敗', e.message))
}

/** 發布審核通知 (含 action 按鈕 + JSON payload) */
export async function publishApproval(approval) {
  if (!BASE) {
    console.warn('[ntfy] 未設定 NTFY_BASE_URL,略過推播 (示範模式)')
    return
  }
  // actionToken 隨通知下發;唯有收到此通知者持有 token 才能 approve/reject
  const t = approval.actionToken ? `?t=${approval.actionToken}` : ''
  const actions =
    APPROVAL_BASE &&
    [
      `http, 允許, ${APPROVAL_BASE}/approve/${approval.id}${t}, method=POST, clear=true`,
      `http, 拒絕, ${APPROVAL_BASE}/reject/${approval.id}${t}, method=POST, clear=true`,
    ].join('; ')

  const headers = {
    ...authHeaders(),
    Title: encodeHeader(`需要授權: ${approval.summary}`),
    Priority: 'high',
    Tags: 'warning',
  }
  if (actions) headers.Actions = actions

  await fetch(`${BASE.replace(/\/$/, '')}/${TOPIC_APPROVALS}`, {
    method: 'POST',
    headers,
    // message 為 Approval JSON,PWA SSE 解析後彈出審核卡片
    body: JSON.stringify(approval),
  }).catch((e) => console.warn('[ntfy] publishApproval 失敗', e.message))
}

// ntfy header 僅接受 ASCII;非 ASCII 以 RFC2047-ish 簡化處理 (base64)
function encodeHeader(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s
  return `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`
}

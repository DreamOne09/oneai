/** 本機 Browser 深度研究 — 偵測意圖、組 Cursor prompt、判斷 worker 在線 */

import { BROWSER_DEEP } from './research-config.js'

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseRe(phrases) {
  const parts = (phrases ?? []).map(p => escapeRegExp(p))
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

export function extractUrls(text) {
  return [...String(text ?? '').matchAll(URL_RE)].map(m => m[0])
}

/** 深度研究：需 Browser 開頁閱讀，非 Tavily snippet 即可 */
export function needsDeepBrowserResearch(text) {
  const t = String(text ?? '').trim()
  if (!t) return false

  const cfg = BROWSER_DEEP()
  const deepRe = phraseRe(cfg.trigger_phrases)
  const urlIntentRe = phraseRe(cfg.url_intent_phrases)
  const urls = extractUrls(t)

  if (urls.length && urlIntentRe?.test(t)) return true
  if (deepRe?.test(t)) return true
  return false
}

export function isCursorWorkerOnline(agents) {
  const cfg = BROWSER_DEEP()
  const wantId = cfg.worker_agent_id ?? 'personal/cursor-worker'
  return (agents ?? []).some(a => {
    if (!a.online) return false
    if (a.agent_id === wantId) return true
    return /cursor/i.test(String(a.display ?? '')) || /cursor/i.test(String(a.agent_id ?? ''))
  })
}

export function buildBrowserResearchPrompt(userMsg) {
  const urls = extractUrls(userMsg)
  const urlBlock = urls.length
    ? `\n\n指定 URL（請用 Browser 工具實際打開）：\n${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : '\n\n（未提供 URL：請先用 Browser 搜尋找到最相關的 1~2 個官方/權威來源，再逐頁閱讀。）'

  return [
    '【OneAI 本機 Browser 深度研究任務】',
    '',
    '你是孟一的深度研究員。必須使用 Cursor 內建的 Browser / Playwright 工具（不可用臆測）。',
    '',
    '步驟：',
    '1. 打開相關網頁，閱讀完整內容（非只看搜尋 snippet）',
    '2. 若有多頁，優先官方文件、最新公告、一級來源',
    '3. 輸出繁體中文報告，結構：',
    '   - 摘要（3~5 句）',
    '   - 關鍵發現（≥5 條 bullet，附來源 URL）',
    '   - 不確定 / 需再查之處',
    '   - 對孟一的行動建議（若有）',
    '',
    `使用者請求：${String(userMsg).trim()}`,
    urlBlock,
  ].join('\n')
}

export function buildDeepResearchQueuedReply(taskId, userMsg) {
  const short = taskId.slice(0, 8)
  const preview = String(userMsg).replace(/\s+/g, ' ').slice(0, 80)
  return [
    '🌐 **本機 Browser 深度研究已派發**',
    '',
    '已交給 **Cursor IDE**（含 Browser 工具）在桌電執行，會實際打開網頁閱讀，比雲端 Tavily 搜尋更完整。',
    '',
    `📋 任務 \`${short}…\``,
    `📝 ${preview}${userMsg.length > 80 ? '…' : ''}`,
    '',
    '桌電需常駐 `cursor_worker.py`（INSTALL-WORKERS.bat）。完成後結果會出現在任務列；也可稍後問「任務結果」。',
  ].join('\n')
}

export function buildDeepResearchFallbackNote() {
  return '⚠️ Cursor worker 離線，改以**雲端快速搜尋**（Tavily/備援），非完整瀏覽器閱讀。若要 Browser 深度研究，請先啟動 `INSTALL-WORKERS.bat`。\n\n'
}

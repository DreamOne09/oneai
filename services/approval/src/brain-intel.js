/** 數位大腦智慧層 — 記憶過濾、路由輔助、選擇性寫回 */

import { MEMORY_WRITE, MEMORY_INJECT } from './memory-config.js'
import { needsMemoryCurate } from './memory-curator.js'

export const MIN_MEMORY_SCORE = MEMORY_INJECT.min_score ?? 0.6
/** 召回意圖時語意距離較大，門檻需低於一般注入 */
export const RECALL_MEMORY_SCORE = MEMORY_INJECT.recall_min_score ?? 0.2
/** 系統知識（kind=system）注入門檻 */
export const SYSTEM_MEMORY_SCORE = MEMORY_INJECT.system_min_score ?? 0.18
export const DEDUP_SCORE = MEMORY_WRITE.dedup_score ?? 0.95
const MAX_INJECT_NORMAL = MEMORY_INJECT.max_normal ?? 2
const MAX_INJECT_RECALL = MEMORY_INJECT.max_recall ?? 4
const MAX_INJECT_SYSTEM = MEMORY_INJECT.max_system ?? 2
const MAX_FACT_CHARS = MEMORY_WRITE.max_fact_chars ?? 220

const EXPLICIT_TRIGGERS = MEMORY_WRITE.explicit_triggers ?? [
  '記住', '幫我記', '帮我记', '別忘了', '别忘了', '不要忘记', '写进记忆', '寫進記憶', 'remember this',
]
const FACT_SIGNALS = MEMORY_WRITE.fact_signals ?? [
  '偏好', '習慣', '決定', 'deadline', '截止', '行程', '出差', '會議', '電話', '地址', 'email',
]
const SKIP_ONLY = MEMORY_WRITE.skip_if_only ?? ['搜尋', '搜索', 'search', '分析：', '怎麼看', '建議']
const SECRET_DENY = MEMORY_WRITE.deny_secrets ?? [
  'api_key', 'api key', 'apikey', 'secret', 'password', '密碼', 'token', 'private_key', 'sk-or-', 'sk-', 'cursor_',
]
const SECRET_RE = new RegExp(SECRET_DENY.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')

const SMALL_TALK_RE = /^(嗨|你好|哈囉|hello|hi|hey|早|晚安|午安|谢谢|謝謝|thanks|ok|好的|收到|在嗎|在吗|test)[\s!?.，。~～]*$/i
const REMEMBER_RE = new RegExp(EXPLICIT_TRIGGERS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
const FACT_RE = new RegExp([...FACT_SIGNALS, '記住', '出差', 'email', '@'].join('|'), 'i')
const SKIP_AUTO_RE = new RegExp(SKIP_ONLY.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
const RECALL_RE = /還記得|还记得|你記得|你记得|你知道我|腦中|脑中|記憶庫|记忆库|之前說|之前说|我說過|我说过/
const SYSTEM_KNOWLEDGE_RE = /oneai|架構|系统架构|系統架構|worker\.py|cursor_worker|cursor worker|agy|zeabur|部署方式|rag-svc|approval-svc|任務佇列|佇列|怎麼跑|怎麼運|怎么运|本機.*worker|送到 cursor|shell.*agent|github.*push|INSTALL-WORKER/i
const SEARCH_PREFIX_RE = /^(請|帮我|幫我|请)?(搜尋|搜索|查一下|查詢|找一下|查查|search|google|幫我找|帮我找)\s*/i

export function memoryToText(m) {
  if (typeof m === 'string') return m
  if (m && typeof m === 'object') return m.text ?? m.content ?? m.snippet ?? JSON.stringify(m)
  return String(m ?? '')
}

export function memoryScore(m) {
  if (typeof m === 'object' && m != null && typeof m.score === 'number') return m.score
  return 0
}

export function filterMemories(raw, userMsg) {
  const recall = needsRecall(userMsg)
  const minScore = recall ? RECALL_MEMORY_SCORE : MIN_MEMORY_SCORE
  const rows = (raw ?? []).filter(m => {
    const text = memoryToText(m)
    if (!text.trim()) return false
    if (/\[E2E TEST\]/i.test(text)) return false
    if (memoryScore(m) > 0 && memoryScore(m) < minScore) return false
    return true
  })
  if (isSmallTalk(userMsg) && !recall) return []
  const out = rows.slice(0, recall ? MAX_INJECT_RECALL : MAX_INJECT_NORMAL)
  // 召回意圖但全被 score 濾掉時，保留最佳 1~2 筆（避免 paraphrase 查詢 mem=0）
  if (recall && out.length === 0 && (raw ?? []).length > 0) {
    const fallback = (raw ?? [])
      .filter(m => {
        const text = memoryToText(m)
        return text.trim() && !/\[E2E TEST\]/i.test(text)
      })
      .sort((a, b) => memoryScore(b) - memoryScore(a))
      .slice(0, 2)
    if (fallback.length && memoryScore(fallback[0]) >= 0.12) return fallback
  }
  return out
}

export function isSmallTalk(text) {
  const t = String(text ?? '').trim()
  if (needsExplicitRemember(t)) return false
  if (hasDurableFactSignal(t)) return false
  if (t.length <= 18 && SMALL_TALK_RE.test(t)) return true
  if (t.length <= 8) return true
  return false
}

export function needsExplicitRemember(text) {
  return REMEMBER_RE.test(String(text ?? ''))
}

/** 使用者試圖把金鑰/密碼寫進記憶 — 必須拒絕（#68） */
export function isSecretMemoryAttempt(text) {
  const t = String(text ?? '')
  if (!needsExplicitRemember(t)) return false
  return SECRET_RE.test(t) || /sk-[a-z0-9]{10,}/i.test(t)
}

export function needsRecall(text) {
  return RECALL_RE.test(String(text ?? ''))
}

export function needsSystemKnowledge(text) {
  return SYSTEM_KNOWLEDGE_RE.test(String(text ?? ''))
}

export function filterSystemMemories(raw) {
  return (raw ?? [])
    .filter(m => {
      const text = memoryToText(m)
      if (!text.trim() || /\[E2E TEST\]/i.test(text)) return false
      const s = memoryScore(m)
      return s === 0 || s >= SYSTEM_MEMORY_SCORE
    })
    .slice(0, MAX_INJECT_SYSTEM)
}

/** 訊息是否含可長期保存的事實信號（非整段對話） */
export function hasDurableFactSignal(text) {
  const t = String(text ?? '').trim()
  if (!t) return false
  if (needsExplicitRemember(t)) return true
  return FACT_RE.test(t)
}

/** 純探索型問題 — 不應 auto-write（搜尋/分析/寒暄） */
export function isEphemeralQuery(text) {
  const t = String(text ?? '').trim()
  if (isSmallTalk(t)) return true
  if (SEARCH_PREFIX_RE.test(t)) return true
  if (SKIP_AUTO_RE.test(t) && !hasDurableFactSignal(t)) return true
  return false
}

/** 從使用者訊息萃取一行事實（不存 assistant 長回覆） */
export function extractMemoryFact(userMsg, explicitRemember) {
  let fact = String(userMsg ?? '').trim()
  if (explicitRemember) {
    fact = fact.replace(/^(請|帮我|幫我|请)?(記住|记住)[：:\s]*/i, '').trim()
  }
  fact = fact.replace(/\s+/g, ' ').slice(0, MAX_FACT_CHARS)
  return fact
}

export function needsWebSearch(text, searchKeywords = []) {
  const t = String(text ?? '').toLowerCase()
  return searchKeywords.some(kw => t.includes(kw.toLowerCase()))
}

export function cleanSearchQuery(text) {
  let q = String(text ?? '').trim()
  q = q.replace(SEARCH_PREFIX_RE, '').replace(/[？?。！!]\s*$/, '').trim()
  return q || String(text ?? '').trim()
}

export function classifyMemoryKind(userMsg, explicitRemember) {
  // orchestrate 自動寫入一律 preference（事實），不產生 episodic memory 洪水
  if (explicitRemember || FACT_RE.test(userMsg)) return 'preference'
  return 'preference'
}

export function buildTopicMarkdown(userMsg, reply, explicitRemember) {
  const date = new Date().toISOString().slice(0, 10)
  const fact = extractMemoryFact(userMsg, explicitRemember)
  const topic = fact.slice(0, 60) || '記憶'
  const kind = classifyMemoryKind(userMsg, explicitRemember)
  return [
    '---',
    `title: ${topic}`,
    `tags: [agent-memory, ${kind}, curated]`,
    'source: oneai-orchestrate',
    `kind: ${kind}`,
    `updated: ${date}`,
    '---',
    '',
    `## 事實`,
    fact,
    '',
    `_出處：OneAI · ${date} · 僅存事實不存整段對話_`,
  ].join('\n')
}

export function buildMemoryBlock(memories) {
  if (!memories.length) return ''
  return `\n\n【孟一的長期記憶（僅注入高相關片段，score≥${MIN_MEMORY_SCORE}）】\n${memories.map((m, i) => `${i + 1}. ${memoryToText(m)}`).join('\n')}\n`
}

export function buildSystemKnowledgeBlock(systemMemories) {
  if (!systemMemories.length) return ''
  return `\n\n【OneAI 系統知識（kind=system，架構/部署 SSOT）】\n${systemMemories.map((m, i) => `${i + 1}. ${memoryToText(m)}`).join('\n')}\n`
}

export function shouldRemember(userMsg, reply, { explicitRemember, smallTalk }) {
  if (isSecretMemoryAttempt(userMsg)) return false
  if (smallTalk) return false
  if (needsSystemKnowledge(userMsg) && !explicitRemember) return false
  if (explicitRemember) return true
  if (isEphemeralQuery(userMsg)) return false
  // 僅當使用者訊息本身含 durable fact 信號才寫入（不論回覆長度）
  return hasDurableFactSignal(userMsg)
}

/** @returns {'explicit'|'fact'|'skip'} */
export function memoryWriteDecision(userMsg, opts = {}) {
  const { explicitRemember = needsExplicitRemember(userMsg), smallTalk = isSmallTalk(userMsg) } = opts
  if (shouldRemember(userMsg, '', { explicitRemember, smallTalk })) {
    return explicitRemember ? 'explicit' : 'fact'
  }
  return 'skip'
}

export function formatRememberPayload(userMsg, reply, explicitRemember) {
  const topicMarkdown = buildTopicMarkdown(userMsg, reply, explicitRemember)
  const kind = classifyMemoryKind(userMsg, explicitRemember)
  const fact = extractMemoryFact(userMsg, explicitRemember)
  return {
    text: topicMarkdown,
    title: explicitRemember ? `fact-${Date.now()}` : `fact-${Date.now()}`,
    topicMarkdown,
    kind,
    fact,
  }
}

export function buildBrainMeta(memories, remembered, writeDecision = null) {
  return {
    memories_used: memories.length,
    memory_preview: memories.slice(0, 2).map(m => memoryToText(m).slice(0, 100)),
    remembered: !!remembered,
    memory_write: writeDecision ?? (remembered ? 'saved' : 'skip'),
  }
}

export function mergeAgentRoute(llmIds, userMsg, searchKeywords, _butlerKeywords) {
  let ids = [...(llmIds ?? [])]
  if (needsSystemKnowledge(userMsg)) {
    if (!ids.includes('engineer')) ids.unshift('engineer')
  }
  if (needsExplicitRemember(userMsg) || needsRecall(userMsg)) {
    if (!ids.includes('butler')) ids.unshift('butler')
  }
  if (needsMemoryCurate(userMsg)) {
    if (!ids.includes('butler')) ids.unshift('butler')
  }
  if (needsWebSearch(userMsg, searchKeywords) && !ids.includes('researcher')) {
    ids.unshift('researcher')
  }
  const searchOnly = needsWebSearch(userMsg, searchKeywords)
    && !needsRecall(userMsg) && !needsExplicitRemember(userMsg)
  if (searchOnly) ids = ids.filter(id => id !== 'butler')
  if (needsExplicitRemember(userMsg) && !needsWebSearch(userMsg, searchKeywords)) {
    ids = ids.filter(id => id === 'butler' || id === 'coach')
  }
  return [...new Set(ids)].slice(0, 3)
}

export function enrichSearchReply(reply, webSearchMeta) {
  if (!webSearchMeta?.sources?.length) return reply
  if (String(reply ?? '').length >= 320) return reply
  const lines = webSearchMeta.sources.slice(0, 3).map((s, i) =>
    `${i + 1}. ${s.title}${s.url ? `\n   ${s.url}` : ''}`,
  )
  return `${reply}\n\n📎 參考來源\n${lines.join('\n')}`
}

export function enforceSearchReply(reply, webSearchMeta) {
  if (!webSearchMeta?.sources?.length) return reply
  const sources = webSearchMeta.sources.slice(0, 3)
  const snippets = webSearchMeta.snippets ?? []
  const block = sources.map((s, i) => {
    const snip = snippets[i] ? `\n   ${String(snippets[i]).slice(0, 120)}…` : ''
    return `${i + 1}. **${s.title}**${s.url ? ` (${s.url})` : ''}${snip}`
  }).join('\n')
  const hasEnough = String(reply ?? '').length >= 200
    && sources.every(s => String(reply).includes(s.title.slice(0, 12)))
  if (hasEnough) return reply
  return `${reply}\n\n🔍 搜尋摘要（${webSearchMeta.provider}）\n${block}`
}

export function buildWorkerContext(agents) {
  const list = agents ?? []
  const online = list.filter(a => a.online)
  const offline = list.length === 0 || online.length === 0
  const summary = { online: online.length, total: list.length, agents: list }
  const block = online.length
    ? `\n\n【本機 Worker 狀態】${online.length} 個在線：${online.map(a => a.display ?? a.agent_id).join('、')}`
    : `\n\n【本機 Worker 狀態】目前無桌機 worker 在線。若建議涉及本機執行，請明確告知需先啟動 worker。`
  const offlineHint = offline ? ' 注意：桌機 worker 離線，不要假設可執行本機任務。' : ''
  return { block, summary, offlineHint, offline }
}

export const PHASE_LABELS = {
  rag_start: '🧠 調取長期記憶…',
  rag_done: '🧠 記憶就緒',
  route_done: '🔍 路由決策完成',
  search_start: '🌐 搜尋最新資料…',
  search_done: '🌐 搜尋完成',
  browser_research_queued: '🖥️ 已派發本機 Browser 深度研究…',
  agent_done: '🤖 專家回覆完成',
  synth_start: '✨ 梅蘭整合中…',
  synth_done: '✨ 整合完成',
  memory_saved: '📝 已寫入記憶',
  skill_saved: '📚 已生成 Skill',
}

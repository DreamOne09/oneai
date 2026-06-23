/** 數位大腦智慧層 — 記憶過濾、路由輔助、選擇性寫回 */

export const MIN_MEMORY_SCORE = 0.6
/** 召回意圖時語意距離較大，門檻需低於一般注入 */
export const RECALL_MEMORY_SCORE = 0.2
/** 系統知識（kind=system）注入門檻 — 架構查詢 paraphrase 較多 */
export const SYSTEM_MEMORY_SCORE = 0.18
export const DEDUP_SCORE = 0.95

const SMALL_TALK_RE = /^(嗨|你好|哈囉|hello|hi|hey|早|晚安|午安|谢谢|謝謝|thanks|ok|好的|收到|在嗎|在吗|test)[\s!?.，。~～]*$/i
const REMEMBER_RE = /記住|幫我記|帮我记|別忘了|别忘了|不要忘记|写进记忆|寫進記憶|remember this/i
const RECALL_RE = /還記得|还记得|你記得|你记得|你知道我|腦中|脑中|記憶庫|记忆库|之前說|之前说|我說過|我说过/
const SYSTEM_KNOWLEDGE_RE = /oneai|架構|系统架构|系統架構|worker\.py|cursor_worker|cursor worker|agy|zeabur|部署方式|rag-svc|approval-svc|任務佇列|佇列|怎麼跑|怎麼運|怎么运|本機.*worker|送到 cursor|shell.*agent|github.*push|INSTALL-WORKER/i
const SEARCH_PREFIX_RE = /^(請|帮我|幫我|请)?(搜尋|搜索|查一下|查詢|找一下|查查|search|google|幫我找|帮我找)\s*/i
const FACT_RE = /記住|出差|行程|偏好|deadline|截止|會議|電話|地址|email|@[\w.-]+/i

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
  const out = rows.slice(0, recall ? 5 : 3)
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
  if (t.length <= 18 && SMALL_TALK_RE.test(t)) return true
  if (t.length <= 8) return true
  return false
}

export function needsExplicitRemember(text) {
  return REMEMBER_RE.test(String(text ?? ''))
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
    .slice(0, 3)
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
  if (explicitRemember || FACT_RE.test(userMsg)) return 'preference'
  return 'memory'
}

export function buildTopicMarkdown(userMsg, reply, explicitRemember) {
  const date = new Date().toISOString().slice(0, 10)
  const topic = explicitRemember
    ? String(userMsg).replace(/^(請|帮我|幫我)?(記住|记住)[：:\s]*/i, '').trim().slice(0, 60)
    : String(userMsg).trim().slice(0, 40)
  const kind = classifyMemoryKind(userMsg, explicitRemember)
  return [
    '---',
    `title: ${topic}`,
    `tags: [agent-memory, ${kind}]`,
    'source: oneai-orchestrate',
    `kind: ${kind}`,
    `updated: ${date}`,
    '---',
    '',
    explicitRemember ? `## 事實\n${topic}` : `## 對話摘要\n**問：** ${userMsg.slice(0, 200)}`,
    '',
    `**答：** ${reply.slice(0, 400)}`,
    '',
    `_出處：OneAI 數位大腦 · ${date}_`,
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
  if (smallTalk) return false
  // 架構/部署問答不寫入個人記憶 — 由 kind=system seed 維護 SSOT
  if (needsSystemKnowledge(userMsg) && !explicitRemember) return false
  if (explicitRemember) return true
  const u = String(userMsg ?? '').trim()
  const r = String(reply ?? '').trim()
  if (u.length >= 24 && r.length >= 120) return true
  return false
}

export function formatRememberPayload(userMsg, reply, explicitRemember) {
  const topicMarkdown = buildTopicMarkdown(userMsg, reply, explicitRemember)
  const kind = classifyMemoryKind(userMsg, explicitRemember)
  return {
    text: topicMarkdown,
    title: explicitRemember ? `fact-${Date.now()}` : `chat-${Date.now()}`,
    topicMarkdown,
    kind,
  }
}

export function buildBrainMeta(memories, remembered) {
  return {
    memories_used: memories.length,
    memory_preview: memories.slice(0, 2).map(m => memoryToText(m).slice(0, 100)),
    remembered: !!remembered,
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
  agent_done: '🤖 專家回覆完成',
  synth_start: '✨ 梅蘭整合中…',
  synth_done: '✨ 整合完成',
  memory_saved: '📝 已寫入記憶',
  skill_saved: '📚 已生成 Skill',
}

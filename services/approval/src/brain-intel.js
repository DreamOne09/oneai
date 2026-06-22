/** 數位大腦智慧層 — 記憶過濾、路由輔助、選擇性寫回 */

export const MIN_MEMORY_SCORE = 0.52

const SMALL_TALK_RE = /^(嗨|你好|哈囉|hello|hi|hey|早|晚安|午安|谢谢|謝謝|thanks|ok|好的|收到|在嗎|在吗|test)[\s!?.，。~～]*$/i
const REMEMBER_RE = /記住|幫我記|帮我记|別忘了|别忘了|不要忘记|写进记忆|寫進記憶|remember this/i
const RECALL_RE = /還記得|还记得|你記得|你记得|你知道我|腦中|脑中|記憶庫|记忆库|之前說|之前说|我說過|我说过/
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

/** 過濾低相關度與測試噪音 */
export function filterMemories(raw, userMsg) {
  const rows = (raw ?? []).filter(m => {
    const text = memoryToText(m)
    if (!text.trim()) return false
    if (/\[E2E TEST\]/i.test(text)) return false
    if (memoryScore(m) > 0 && memoryScore(m) < MIN_MEMORY_SCORE) return false
    return true
  })
  // 寒暄不注入記憶（除非明確要 recall）
  if (isSmallTalk(userMsg) && !needsRecall(userMsg)) return []
  return rows.slice(0, 3)
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

export function needsWebSearch(text, searchKeywords = []) {
  const t = String(text ?? '').toLowerCase()
  return searchKeywords.some(kw => t.includes(kw.toLowerCase()))
}

export function cleanSearchQuery(text) {
  let q = String(text ?? '').trim()
  q = q.replace(SEARCH_PREFIX_RE, '').replace(/[？?。！!]\s*$/, '').trim()
  return q || String(text ?? '').trim()
}

export function buildMemoryBlock(memories) {
  if (!memories.length) return ''
  return `\n\n【孟一的長期記憶（僅注入高相關片段）】\n${memories.map((m, i) => `${i + 1}. ${memoryToText(m)}`).join('\n')}\n`
}

export function shouldRemember(userMsg, reply, { explicitRemember, smallTalk }) {
  if (smallTalk) return false
  if (explicitRemember) return true
  const u = String(userMsg ?? '').trim()
  const r = String(reply ?? '').trim()
  // 實質對話：雙方都有內容
  if (u.length >= 24 && r.length >= 120) return true
  return false
}

export function formatRememberPayload(userMsg, reply, explicitRemember) {
  const date = new Date().toISOString().slice(0, 10)
  if (explicitRemember) {
    const fact = String(userMsg).replace(/^(請|帮我|幫我)?(記住|记住)[：:\s]*/i, '').trim()
    return { text: `[事實 ${date}] ${fact}`, title: `fact-${Date.now()}` }
  }
  return {
    text: `[對話 ${date}]\n問：${userMsg.slice(0, 200)}\n答：${reply.slice(0, 500)}`,
    title: `chat-${Date.now()}`,
  }
}

export function buildBrainMeta(memories, remembered) {
  return {
    memories_used: memories.length,
    memory_preview: memories.slice(0, 2).map(m => memoryToText(m).slice(0, 100)),
    remembered: !!remembered,
  }
}

export function mergeAgentRoute(llmIds, userMsg, searchKeywords, butlerKeywords) {
  let ids = [...(llmIds ?? [])]

  if (needsExplicitRemember(userMsg) || needsRecall(userMsg)) {
    if (!ids.includes('butler')) ids.unshift('butler')
  }
  if (needsWebSearch(userMsg, searchKeywords) && !ids.includes('researcher')) {
    ids.unshift('researcher')
  }

  // 純搜尋時不拉管家（減少冗餘 agent）
  const searchOnly = needsWebSearch(userMsg, searchKeywords)
    && !needsRecall(userMsg) && !needsExplicitRemember(userMsg)
  if (searchOnly) ids = ids.filter(id => id !== 'butler')

  // 記住/回想時優先管家，最多再配一個專家
  if (needsExplicitRemember(userMsg) && !needsWebSearch(userMsg, searchKeywords)) {
    ids = ids.filter(id => id === 'butler' || id === 'coach')
  }

  return [...new Set(ids)].slice(0, 3)
}

export function enrichSearchReply(reply, webSearchMeta) {
  if (!webSearchMeta?.sources?.length) return reply
  if (String(reply ?? '').length >= 280) return reply
  const lines = webSearchMeta.sources.slice(0, 3).map((s, i) =>
    `${i + 1}. ${s.title}${s.url ? `\n   ${s.url}` : ''}`,
  )
  return `${reply}\n\n📎 參考來源\n${lines.join('\n')}`
}

/** Butler Phase B — 記憶整理規則（與 brain/rag/curate.py 對齊） */

const KEEP_KINDS = new Set(['preference', 'system', 'sop', 'reflection'])
const JUNK_MARKERS = ['## 對話摘要', '**答：**', '**問：**', '梅蘭直答', 'chat-']
const CURATED_MARKERS = ['curated', '仅存事实', '僅存事實', '## 事實']
const CURATE_TRIGGER_RE = /整理記憶|整理记忆|清理記憶|清理记忆|記憶庫整理|刪除舊記憶|清除對話摘要/

export function needsMemoryCurate(text) {
  return CURATE_TRIGGER_RE.test(String(text ?? ''))
}

export function isJunkMemoryChunk(text, meta = {}) {
  const kind = meta.kind || 'memory'
  const tags = String(meta.tags || '')
  const title = String(meta.title || '')
  const combined = `${title}\n${text || ''}`

  if (KEEP_KINDS.has(kind)) return { junk: false, reason: 'keep_kind' }
  if (tags.includes('curated') || tags.includes('system')) return { junk: false, reason: 'curated_tag' }
  if (CURATED_MARKERS.some(m => combined.includes(m))) return { junk: false, reason: 'fact_format' }
  if (JUNK_MARKERS.some(m => combined.includes(m))) return { junk: true, reason: 'episodic_transcript' }
  if (meta.source === 'oneai-orchestrate' && kind === 'memory') {
    return { junk: true, reason: 'legacy_orchestrate_memory' }
  }
  if (/\[E2E TEST\]/i.test(combined)) return { junk: true, reason: 'e2e_test' }
  return { junk: false, reason: 'keep' }
}

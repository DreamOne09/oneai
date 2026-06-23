/**
 * OneAI 系統知識（kind=system）— 架構 SSOT 寫入 RAG，與個人記憶分離。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

function loadArchConfig() {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    const p = join(__dir, '..', '..', '..', 'config', 'oneai.system-architecture.json')
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** 組成可索引的 markdown（frontmatter kind=system） */
export function buildSystemMemoryMarkdown(arch = loadArchConfig()) {
  if (!arch?.one_liner) return null
  const v = arch._version ?? '?'
  const date = arch._updated ?? new Date().toISOString().slice(0, 10)
  const layers = arch.layers ?? {}
  const facts = (arch.critical_facts ?? []).map(f => `- ${f}`).join('\n')
  const deploy = Object.entries(arch.deploy_matrix ?? {})
    .map(([k, v]) => `- ${k}: ${v}`).join('\n')

  return [
    '---',
    'title: OneAI 系統架構 SSOT',
    'tags: [oneai, system, architecture, ssot]',
    'source: oneai-system-seed',
    'kind: system',
    `version: ${v}`,
    `updated: ${date}`,
    '---',
    '',
    `# OneAI 系統架構 v${v}`,
    '',
    arch.one_liner,
    '',
    '## 分層',
    '',
    `- **手機**：${layers.phone?.name ?? 'PWA'} — ${layers.phone?.role ?? ''}`,
    `- **雲端 approval**：${layers.cloud?.approval_svc?.url ?? ''} — ${layers.cloud?.approval_svc?.role ?? ''}`,
    `- **雲端 rag**：${layers.cloud?.rag_svc?.host ?? ''} — ${layers.cloud?.rag_svc?.role ?? ''}`,
    `- **本機 agy**：${layers.local?.agy_worker?.file ?? 'worker.py'} — ${layers.local?.agy_worker?.role ?? ''}`,
    `- **本機 Cursor**：${layers.local?.cursor_worker?.file ?? 'cursor_worker.py'} — ${layers.local?.cursor_worker?.role ?? ''}`,
    '',
    '## 必知事實',
    facts,
    '',
    '## 部署方式',
    deploy,
    '',
    '## 記憶分層說明',
    '- L1 靜態：config 注入 system prompt（每次對話必有）',
    '- L3 個人：kind=memory/preference（孟一的偏好與對話）',
    '- L3 系統：kind=system（本文件，架構/部署 SSOT，不與個人記憶混寫）',
    '',
    `_SSOT · ${date}_`,
  ].join('\n')
}

const SEED_TITLE = 'oneai-system-architecture'

/** 啟動時 idempotent 寫入 RAG（dedup ≥0.95 會跳過） */
export async function seedSystemMemoryIfNeeded(ragRememberSmart) {
  const text = buildSystemMemoryMarkdown()
  if (!text) {
    console.warn('[system-memory] 略過 seed：找不到 oneai.system-architecture.json')
    return false
  }
  try {
    await ragRememberSmart(text, SEED_TITLE, 'system')
    console.log('[system-memory] 已確保 kind=system 架構 SSOT 在 RAG')
    return true
  } catch (e) {
    console.warn('[system-memory] seed 失敗（RAG 可能離線）:', e.message?.slice(0, 80))
    return false
  }
}

export { SEED_TITLE }

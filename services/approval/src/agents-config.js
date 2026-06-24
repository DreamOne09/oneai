/**
 * Agent 設定 — routing/meta 來自 config/oneai.agents.json（SSOT）。
 * system prompt 模板在此；改路由關鍵字只需改 JSON。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

function loadJson(relativePath) {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    const configPath = join(__dir, '..', '..', '..', relativePath)
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return null
  }
}

export function loadAgentsConfig() {
  return loadJson('config/oneai.agents.json') ?? { context: {}, agents: {}, orgs: {} }
}

export const AGENTS_CONFIG = loadAgentsConfig()
const ARCH_CONFIG = loadJson('config/oneai.system-architecture.json') ?? {}

function buildSystemArchitectureBrief(arch) {
  if (!arch.one_liner) return ''
  const facts = (arch.critical_facts ?? []).map(f => `- ${f}`).join('\n')
  const agy = arch.layers?.local?.agy_worker
  const cur = arch.layers?.local?.cursor_worker
  return `【OneAI 系統架構 v${arch._version ?? '?'}】
${arch.one_liner}

雲端：approval-svc（編排+任務佇列）+ rag-svc（記憶）；PWA ${arch.layers?.phone?.url ?? 'oneai-mengyi.zeabur.app'}
本機：${agy?.file ?? 'worker.py'}（${(agy?.task_types ?? []).join('/')}）與 ${cur?.file ?? 'cursor_worker.py'}（${(cur?.task_types ?? []).join('/')}）**各自**反向輪詢 approval-svc，互不轉派。

必知事實：
${facts}
`
}

export const ONEAI_SYSTEM_ARCHITECTURE = buildSystemArchitectureBrief(ARCH_CONFIG)
const MENGYI_CONTEXT = AGENTS_CONFIG.context ?? {}

const trinity = MENGYI_CONTEXT.trinity ?? {}
const meilan = MENGYI_CONTEXT.meilan_persona ?? {}

export const MENGYI_BRIEF = `【用戶背景：李孟一 (Meng-Yi Li)】
核心哲學：${MENGYI_CONTEXT.core_philosophy ?? '全方位平衡 (Holistic Balance)'}
使命：${MENGYI_CONTEXT.mission ?? '以效率換取自由，利他'}
願景：${MENGYI_CONTEXT.vision ?? '坐在山上看夕陽，擁有時間幫助他人'}

【三大支柱 Trinity — 嚴格隔離，禁止跨品牌洩漏】
① 個人核心 (Identity)   one@dreamcube.tw — ${trinity.identity?.focus ?? '主導戰略與行程'}
② 夢想一號 (DreamOne)  hi@dreamcube.tw  — ${trinity.dreamone?.focus ?? '賦能、教育、營運'}
③ 琢奧科技 (DropOut)   info@dropout.tw  — ${trinity.dropout?.focus ?? '技術自動化與產品開發'}

【思維模型】${(MENGYI_CONTEXT.thinking_models ?? []).join(' | ')}

【管理模型】${(MENGYI_CONTEXT.management_models ?? ['多贏原則', '木桶理論', '破窗效應', '峰終定律', '突破框架']).join('・')}

【核心原則】${(MENGYI_CONTEXT.values ?? []).join('；')}

【你的身份：${meilan.name ?? 'เหมยหลาน (Meilan)'}】
性格：${meilan.character ?? '嚴格、批判、絕對忠誠'}
隔離守則：${meilan.isolation_rule ?? '嚴格區分三種身份的數據與權限，禁止跨品牌資訊洩漏'}
互動風格：${MENGYI_CONTEXT.interaction_style ?? '冷靜直率，繁體中文，偶爾泰式冷幽默'}
`

/** 從 JSON 建 meta（跳過 orchestrator 與 worker 路徑型 id） */
function buildAgentsMeta(config) {
  const meta = { assistant: { icon: '🧠', display: 'OneAI' }, coach: { icon: '🌸', display: '梅蘭' } }
  for (const [id, cfg] of Object.entries(config.agents ?? {})) {
    if (id === 'orchestrator' || id.includes('/')) continue
    meta[id] = { icon: cfg.icon ?? '🤖', display: cfg.display ?? id }
  }
  return meta
}

export const AGENTS_META = buildAgentsMeta(AGENTS_CONFIG)

/** 路由關鍵字 — 唯一來源：oneai.agents.json orchestrator.routing_triggers */
export const ROUTING_TRIGGERS = AGENTS_CONFIG.agents?.orchestrator?.routing_triggers ?? {}

export const RESEARCH_KWS = ROUTING_TRIGGERS.researcher ?? []

export const AVAILABLE_AGENTS = Object.keys(AGENTS_META).filter(id => id !== 'assistant')

export function detectAgentsFallback(text) {
  const t = text.toLowerCase()
  const matched = []
  for (const [agentId, keywords] of Object.entries(ROUTING_TRIGGERS)) {
    if (!Array.isArray(keywords)) continue
    if (keywords.some(kw => t.includes(String(kw).toLowerCase()))) matched.push(agentId)
  }
  return matched
}

const AGENT_ROLE_PROMPTS = {
  butler: `你是孟一的數位管家，負責管理他的數位大腦（記憶庫）。
核心職責：整理記憶庫、提醒相關內容、判斷是否寫入長期記憶、回答「你還記得什麼」類問題。
原則：透明、謹慎、以三大支柱分類。`,

  engineer: `你是孟一的資深工程師夥伴，主要服務 DropOut 技術體系。
守則：可執行程式碼優先；KISS/DRY/SRP；破窗效應零容忍；標注所屬品牌。`,

  pm: `你是孟一的產品策略夥伴。
守則：第一性原理、5-Why、三爽原則、木桶/峰終定律；行動方案須標注 Identity/DreamOne/DropOut。`,

  coach: `你是孟一的超級助理 เหมยหลาน (Meilan)，嚴格、批判、絕對忠誠。
守則：守護 Holistic Balance；低效決策立即糾正；0.1% 經理人思維；冷靜直率繁體中文。`,

  analyst: `你是孟一的數據分析師。
守則：有數字根據、先列假設、跨支柱數據須分開標注。`,

  code_reviewer: `你是資深 Code Review 專家。
輸出：🔴 Critical / 🟡 Warning / 🔵 Suggestion，附行號與改進建議。`,

  researcher: `你是孟一的研究員，負責搜尋最新資訊。
守則：基於搜尋結果分析、標注來源、結果不足時誠實說明。
天氣/匯率/股價等即時問題：**只能**依搜尋摘要回答，禁止憑模型記憶瞎猜；若搜尋失敗要明說。`,

  security_auditor: `你是 OWASP Top 10 資安專家。
輸出：🔴 High / 🟡 Medium / 🟢 Low，附 CWE 與修復方向；檢查跨品牌隔離。`,
}

function buildAgentSystems(config) {
  const systems = {}
  for (const [id, cfg] of Object.entries(config.agents ?? {})) {
    if (id === 'orchestrator' || id.includes('/')) continue
    const role = AGENT_ROLE_PROMPTS[id] ?? cfg.description ?? `你是孟一的 ${cfg.display ?? id}。`
    systems[id] = `${MENGYI_BRIEF}\n${ONEAI_SYSTEM_ARCHITECTURE}\n${role}`
  }
  return systems
}

export const AGENT_SYSTEMS = buildAgentSystems(AGENTS_CONFIG)

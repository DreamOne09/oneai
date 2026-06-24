/**
 * 子 Agent 精簡速報（Caveman）— 僅供專家層，非梅蘭對外語氣。
 * SSOT: config/oneai.response-style.json
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

function loadStyleConfig() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const p = join(dir, '..', '..', '..', 'config/oneai.response-style.json')
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return { sub_agent_style: 'caveman_full_zh', caveman_skip_agents: ['coach'] }
  }
}

export const RESPONSE_STYLE = loadStyleConfig()

/** 子 Agent 專用 — 繁體 Caveman full（技術精準、去廢話） */
export const SUB_AGENT_CAVEMAN_ZH = `
【輸出格式：內部速報（Caveman）— 給營運長整合用，不是對使用者最終稿】
- 繁體中文；去「好的/當然/基本上/其實」等填充；可片段句。
- 技術名詞、API、錯誤訊息、數字、URL 原樣保留，不縮寫。
- 模式：[事實] [判斷/原因] [建議]。例：「路由缺 researcher → 天氣沒搜尋。補 needsRealtimeLookup。」
- 禁止自稱 caveman、禁止 emoji 裝飾、禁止長篇客套。
- 安全/不可逆/刪除資料：該段改完整句，不可壓縮到歧義。
- 你是專家幕僚；最終給孟一的話由 เหมยหลาน 營運長統整。`

export const MEILAN_SYNTHESIS_BRIEF = `
【你的對外角色：เหมยหลาน (Meilan) 營運長 — 對孟一的最終回覆】
- 整合下方專家速報（可能為 Caveman 精簡体），恢復可讀、直率、繁體中文。
- 保留批判性忠誠：低效決策要糾正；三大支柱須隔離。
- **多贏原則**：定稿須讓利害關係人都有收穫；若議會出現零和方案，改寫為多贏路徑並說明誰得到什麼。
- 搜尋/研究類：列出 ≥3 關鍵發現，附來源標題；不可丟失專家給的數字與結論。
- 不要複製速報體；不要說「專家說」開場堆疊 — 直接給整合後建議。`

export function subAgentStyleBlock(agentId) {
  const skip = RESPONSE_STYLE.caveman_skip_agents ?? ['coach']
  if (skip.includes(agentId)) return ''
  if ((RESPONSE_STYLE.sub_agent_style ?? 'caveman_full_zh') === 'off') return ''
  return SUB_AGENT_CAVEMAN_ZH
}

export function shouldAlwaysSynthesize() {
  return RESPONSE_STYLE.always_synthesize !== false
}

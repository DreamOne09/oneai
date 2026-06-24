/**
 * Agent 路由單元測試 — 確認各子 Agent 關鍵字/規則能觸發
 * node scripts/agent-routing.test.js
 */
import {
  mergeAgentRoute,
  needsRealtimeLookup,
  needsExplicitRemember,
  needsSystemKnowledge,
} from '../services/approval/src/brain-intel.js'
import {
  detectAgentsFallback,
  RESEARCH_KWS,
  ROUTING_TRIGGERS,
  AGENT_SYSTEMS,
} from '../services/approval/src/agents-config.js'
import { subAgentStyleBlock } from '../services/approval/src/caveman-style.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; return }
  failed++
  console.error('FAIL:', msg)
}

function route(userMsg, llmIds = []) {
  const butlerKws = ROUTING_TRIGGERS.butler ?? []
  return mergeAgentRoute(llmIds, userMsg, RESEARCH_KWS, butlerKws)
}

function includesAll(ids, expected) {
  return expected.every(e => ids.includes(e))
}

// ── 關鍵字 fallback（detectAgentsFallback）────────────────────────────────
assert(includesAll(detectAgentsFallback('幫我寫 deploy script'), ['engineer']), 'fallback engineer')
assert(includesAll(detectAgentsFallback('OKR 怎麼訂'), ['pm']), 'fallback pm')
assert(includesAll(detectAgentsFallback('搜尋 Tavily'), ['researcher']), 'fallback researcher')
assert(includesAll(detectAgentsFallback('記住：偏好深色'), ['butler']), 'fallback butler')
assert(includesAll(detectAgentsFallback('code review 這段'), ['code_reviewer']), 'fallback code_reviewer')
assert(includesAll(detectAgentsFallback('XSS 資安'), ['security_auditor']), 'fallback security')

// ── mergeAgentRoute 規則層 ───────────────────────────────────────────────
assert(route('明天天氣如何').includes('researcher'), 'weather → researcher')
assert(route('OneAI worker 怎麼跑').includes('engineer'), 'system knowledge → engineer')
assert(route('記住我偏好英文').includes('butler'), 'remember → butler')
assert(route('你還記得語言偏好嗎').includes('butler'), 'recall → butler')
assert(route('分析 PWA vs worker').some(id => ['pm', 'analyst', 'engineer'].includes(id))
  || detectAgentsFallback('分析 PWA vs worker').length > 0, 'analysis triggers expert')

// ── LLM 回空 → 梅蘭直答路徑（無子 agent）────────────────────────────────
assert(route('你好').length === 0, 'small talk route empty → coach direct in harness')

// ── Caveman 只給子 Agent，coach 無 ───────────────────────────────────────
assert(subAgentStyleBlock('coach') === '', 'coach no caveman')
assert(subAgentStyleBlock('engineer').includes('Caveman'), 'engineer has caveman')
assert(subAgentStyleBlock('researcher').includes('Caveman'), 'researcher has caveman')
assert(!AGENT_SYSTEMS.coach.includes('內部速報'), 'coach system no caveman block')
assert(AGENT_SYSTEMS.engineer.includes('內部速報'), 'engineer system has caveman block')

console.log(`\nagent-routing: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

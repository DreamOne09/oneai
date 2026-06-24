/**
 * deep-research 單元測試 — node scripts/deep-research.test.js
 */
import {
  needsDeepBrowserResearch,
  extractUrls,
  isCursorWorkerOnline,
  buildBrowserResearchPrompt,
} from '../services/approval/src/deep-research.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; return }
  failed++
  console.error('FAIL:', msg)
}

assert(needsDeepBrowserResearch('深度研究 Zeabur 定價'), 'deep phrase')
assert(needsDeepBrowserResearch('打開 https://zeabur.com 讀完整 pricing'), 'url + intent')
assert(!needsDeepBrowserResearch('搜尋 Tavily API'), 'quick search not deep')
assert(!needsDeepBrowserResearch('今天天氣'), 'not research')

assert(extractUrls('見 https://a.com/x 和 http://b.org').length === 2, 'extract urls')

assert(
  isCursorWorkerOnline([{ agent_id: 'personal/cursor-worker', online: true, display: 'Cursor IDE' }]),
  'cursor online',
)
assert(
  !isCursorWorkerOnline([{ agent_id: 'personal/cursor-worker', online: false, display: 'Cursor IDE' }]),
  'cursor offline',
)

const prompt = buildBrowserResearchPrompt('深度研究 https://example.com/docs')
assert(prompt.includes('Browser'), 'prompt mentions browser')
assert(prompt.includes('https://example.com/docs'), 'prompt includes url')

console.log(`\ndeep-research: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

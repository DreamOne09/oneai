/**
 * brain-intel 單元測試 — node scripts/brain-intel.test.js
 */
import {
  filterMemories,
  isSmallTalk,
  needsExplicitRemember,
  cleanSearchQuery,
  shouldRemember,
  memoryWriteDecision,
  hasDurableFactSignal,
  isEphemeralQuery,
  extractMemoryFact,
  needsRealtimeLookup,
  needsAnyWebLookup,
  mergeAgentRoute,
  enforceSearchReply,
  classifyMemoryKind,
  needsSystemKnowledge,
  filterSystemMemories,
  buildSystemKnowledgeBlock,
  isSecretMemoryAttempt,
  RECALL_MEMORY_SCORE,
  MIN_MEMORY_SCORE,
  SYSTEM_MEMORY_SCORE,
} from '../services/approval/src/brain-intel.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; return }
  failed++
  console.error('FAIL:', msg)
}

assert(isSmallTalk('嗨'), '寒暄 hi')
assert(isSmallTalk('hello!'), '寒暄 hello')
assert(!isSmallTalk('記住：我下週出差曼谷'), '非寒暄 remember')

assert(needsExplicitRemember('記住：偏好繁體'), 'explicit remember')
assert(needsExplicitRemember('幫我記這件事'), '幫我記')
assert(!needsExplicitRemember('搜尋 Tavily'), '非 remember')

assert(cleanSearchQuery('搜尋 Tavily API') === 'Tavily API', 'clean search 搜尋')
assert(cleanSearchQuery('幫我查一下 React 19') === 'React 19', 'clean search 查一下')

const raw = [
  { text: '高相關', score: 0.85 },
  { text: '低相關', score: 0.4 },
  { text: '[E2E TEST] skip', score: 0.9 },
]
const filtered = filterMemories(raw, '我下週出差曼谷的計畫')
assert(filtered.length === 1 && filtered[0].text === '高相關', 'filter score + e2e')
assert(filterMemories(raw, '嗨').length === 0, 'small talk no memory inject')
const recallRaw = [{ text: '偏好繁體中文', score: 0.26 }]
assert(filterMemories(recallRaw, '你還記得偏好嗎').length === 1, 'recall threshold 0.20')

assert(!shouldRemember('嗨', '你好呀', { explicitRemember: false, smallTalk: true }), 'no remember small talk')
assert(shouldRemember('記住：偏好', '好的', { explicitRemember: true, smallTalk: false }), 'remember explicit')
assert(
  !shouldRemember('a'.repeat(30), 'b'.repeat(130), { explicitRemember: false, smallTalk: false }),
  'no remember long exchange without fact signal',
)
assert(
  shouldRemember('我下週三要去曼谷出差', '好的', { explicitRemember: false, smallTalk: false }),
  'remember when user msg has fact signal',
)
assert(memoryWriteDecision('搜尋 Zeabur') === 'skip', 'skip search-only')
assert(memoryWriteDecision('記住：偏好繁體') === 'explicit', 'explicit write')
assert(isEphemeralQuery('分析：PWA 還是 worker 優先'), 'ephemeral analysis')
assert(hasDurableFactSignal('記住：我偏好深色模式'), 'durable explicit')
assert(extractMemoryFact('記住：我偏好深色模式', true).includes('深色'), 'extract fact')

const route = mergeAgentRoute(['engineer'], '記住我偏好深色模式', ['搜尋'], ['記住'])
assert(route.includes('butler'), 'butler on remember')

assert(needsRealtimeLookup('明天曼谷天氣如何'), 'weather bangkok')
assert(needsRealtimeLookup('明天天氣如何'), 'weather tomorrow')
assert(!needsRealtimeLookup('你好'), 'not weather hi')
const weatherRoute = mergeAgentRoute([], '明天天氣如何', ['搜尋'], [])
assert(weatherRoute.includes('researcher'), 'weather routes researcher')
assert(weatherRoute.includes('天氣') || weatherRoute[0] === 'researcher', 'researcher first for weather')

const ws = {
  provider: 'tavily',
  sources: [
    { title: 'Tavily Docs', url: 'https://tavily.com' },
    { title: 'API Guide', url: 'https://example.com' },
    { title: 'Search Tips', url: 'https://example.org' },
  ],
  snippets: ['s1', 's2', 's3'],
}
const enforced = enforceSearchReply('短回覆', ws)
assert(enforced.includes('Tavily Docs'), 'enforce search source 1')
assert(enforced.includes('API Guide'), 'enforce search source 2')
assert(enforced.includes('Search Tips'), 'enforce search source 3')

assert(classifyMemoryKind('記住出差日期', true) === 'preference', 'fact kind')
assert(classifyMemoryKind('今天天氣如何', false) === 'preference', 'orchestrate writes preference only')

assert(RECALL_MEMORY_SCORE === 0.2, 'recall score threshold 0.2')
assert(MIN_MEMORY_SCORE === 0.6, 'score threshold 0.6')
assert(SYSTEM_MEMORY_SCORE === 0.18, 'system score threshold')

assert(needsSystemKnowledge('OneAI 架構怎麼跑'), 'system knowledge arch')
assert(needsSystemKnowledge('cursor_worker 和 agy 有通嗎'), 'system knowledge worker')
assert(!needsSystemKnowledge('今天天氣如何'), 'not system knowledge')

assert(
  !shouldRemember('OneAI worker 怎麼常駐', 'b'.repeat(130), { explicitRemember: false, smallTalk: false }),
  'no remember system architecture chat',
)

const sysRaw = [{ text: 'agy 與 cursor 平行輪詢', score: 0.22 }]
assert(filterSystemMemories(sysRaw).length === 1, 'system memory filter')
assert(buildSystemKnowledgeBlock(sysRaw).includes('kind=system'), 'system block label')

assert(!shouldRemember('記住：我的 OPENAI_API_KEY 是 sk-test', '', { explicitRemember: true, smallTalk: false }), 'deny secret memory')
assert(isSecretMemoryAttempt('記住：API key sk-or-v1-abc'), 'secret attempt detect')

console.log(`\nbrain-intel: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

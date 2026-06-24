/** memory-curator 單元測試 — node scripts/memory-curator.test.js */
import { isJunkMemoryChunk, needsMemoryCurate } from '../services/approval/src/memory-curator.js'

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed++; return }
  failed++
  console.error('FAIL:', msg)
}

assert(needsMemoryCurate('幫我整理記憶庫'), 'curate trigger')
assert(!needsMemoryCurate('今天天氣'), 'not curate')

const junk = isJunkMemoryChunk('## 對話摘要\n**問：** hi\n**答：** hello', { kind: 'memory', source: 'oneai-orchestrate' })
assert(junk.junk === true, 'episodic junk')

const keep = isJunkMemoryChunk('## 事實\n偏好繁體中文', { kind: 'preference', tags: 'curated' })
assert(keep.junk === false, 'fact keep')

console.log(`\nmemory-curator: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

/** brain-graph 單元測試 — node scripts/brain-graph.test.js */
import { buildMemoryGraph, parseTags } from '../services/approval/src/brain-graph.js'

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed++; return }
  failed++
  console.error('FAIL:', msg)
}

assert(parseTags('preference,oneai', '').includes('preference'), 'parse comma tags')
assert(parseTags('', 'tags: [agent-memory, system]').includes('system'), 'parse frontmatter tags')

const items = [
  { id: 'a', text: '偏好繁體中文', kind: 'preference', tags: 'preference,lang' },
  { id: 'b', text: '也偏好繁體', kind: 'preference', tags: 'preference,lang' },
  { id: 'c', text: 'OneAI 架構', kind: 'system', tags: 'oneai,system' },
]
const g = buildMemoryGraph(items)
assert(g.nodes.some(n => n.id === 'hub:preference'), 'kind hub')
assert(g.nodes.some(n => n.id === 'tag:preference'), 'shared tag node')
assert(g.links.some(l => l.type === 'related'), 'memory-memory link')
assert(g.stats.memories === 3, 'memory count')

console.log(`\nbrain-graph: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

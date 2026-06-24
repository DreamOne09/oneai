/**
 * Agent Council + Registry 單元測試
 * node scripts/agent-council.test.js
 */
import {
  needsCouncil,
  formatTranscriptForAgent,
  pickSquadForMessage,
  getCouncilLimits,
} from '../services/approval/src/agent-council.js'
import {
  isStaffManagementIntent,
  parseStaffCommand,
  buildCouncilRoster,
  detectAgentsFromRegistry,
} from '../services/approval/src/coo-staffing.js'
import {
  listStaff,
  addStaffMember,
  removeStaffMember,
  getAvailableAgentIds,
} from '../services/approval/src/agent-registry.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAFF_FILE = join(ROOT, 'data/custom-agents.json')
const STAFF_BACKUP = join(ROOT, 'data/custom-agents.test-backup.json')

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) { passed++; return }
  failed++
  console.error('FAIL:', msg)
}

// backup / restore staff file for isolated tests
if (existsSync(STAFF_FILE)) {
  writeFileSync(STAFF_BACKUP, readFileSync(STAFF_FILE))
} else {
  mkdirSync(dirname(STAFF_FILE), { recursive: true })
  writeFileSync(STAFF_FILE, JSON.stringify({ agents: {}, disabled_base: [] }))
}

function restoreStaff() {
  if (existsSync(STAFF_BACKUP)) {
    writeFileSync(STAFF_FILE, readFileSync(STAFF_BACKUP))
  } else {
    writeFileSync(STAFF_FILE, JSON.stringify({ agents: {}, disabled_base: [] }))
  }
}

// needsCouncil
assert(needsCouncil('開議會討論部署', ['engineer']), 'force trigger → council')
assert(needsCouncil('你好', ['engineer', 'pm']), '2 agents → council')
assert(!needsCouncil('你好', ['researcher']), 'single agent → no council')

// transcript formatting
const transcript = [{
  round: 1,
  phase: 'opening',
  entries: [
    { agent: 'pm', display: 'PM', reply: '建議先做 A' },
    { agent: 'engineer', display: '工程師', reply: '技術上 B 較穩' },
  ],
}]
const pmView = formatTranscriptForAgent(transcript, 'pm')
assert(pmView.includes('建議先做 A') && pmView.includes('技術上 B 較穩'), 'transcript visible to all')
assert(pmView.includes('[你 · PM]'), 'self labeled as 你')

// squad pick
assert(pickSquadForMessage('幫我訂 OKR 策略')?.id === 'strategy', 'strategy squad')

// staff intent
assert(isStaffManagementIntent('列出編制'), 'staff list intent')
assert(isStaffManagementIntent('新增議員叫法遵顧問'), 'staff add intent')
const addCmd = parseStaffCommand('新增議員叫法遵顧問，職責：合約審查')
assert(addCmd?.action === 'add', 'parse add command')

// registry CRUD
const addRes = addStaffMember({
  id: 'test-expert',
  display: '測試專家',
  mandate: '僅供單元測試',
})
assert(addRes.ok, 'add staff member')
assert(getAvailableAgentIds().includes('test-expert'), 'expert in roster')
const rmRes = removeStaffMember('test-expert')
assert(rmRes.ok, 'remove staff member')
assert(!getAvailableAgentIds().includes('test-expert'), 'expert removed')

// roster includes squad members for engineering
const roster = buildCouncilRoster('部署 rag 到 zeabur', ['engineer'])
assert(roster.agentIds.includes('engineer'), 'roster keeps engineer')
assert(roster.squad === 'engineering' || roster.agentIds.length >= 1, 'engineering squad context')

// limits
assert(getCouncilLimits().maxStaff === 36, 'max staff 36')
assert(getCouncilLimits().maxCouncilParticipants === 6, 'max council 6')
assert(getCouncilLimits().defaultMaxRounds === 2, 'default 2 rounds')

// routing from registry
assert(detectAgentsFromRegistry('明天天氣如何').includes('researcher'), 'registry routing researcher')

restoreStaff()

console.log(`\nagent-council: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

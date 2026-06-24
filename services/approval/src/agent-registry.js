/**
 * Agent Registry — 數位辦公室人事檔案（營運長可增刪改）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadAgentsConfig, MENGYI_BRIEF, ONEAI_SYSTEM_ARCHITECTURE } from './agents-config.js'
import { subAgentStyleBlock } from './caveman-style.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function loadJson(relativePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf-8'))
  } catch {
    return fallback
  }
}

function councilConfig() {
  return loadJson('config/oneai.council.json', {})
}

export function getCouncilLimits() {
  const c = councilConfig()
  return {
    maxStaff: c.max_staff ?? 36,
    maxCouncilParticipants: c.max_council_participants ?? 6,
    defaultMaxRounds: c.default_max_rounds ?? 2,
    highStakesMaxRounds: c.high_stakes_max_rounds ?? 3,
  }
}

function staffFilePath() {
  const rel = councilConfig().staff_file ?? 'data/custom-agents.json'
  return join(ROOT, rel)
}

function loadStaffOverlay() {
  try {
    const p = staffFilePath()
    if (!existsSync(p)) return { agents: {}, disabled_base: [], updated_at: null }
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return { agents: {}, disabled_base: [], updated_at: null }
  }
}

function saveStaffOverlay(overlay) {
  const p = staffFilePath()
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  const data = { ...overlay, updated_at: new Date().toISOString() }
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, p)
  return data
}

const BASE_ROLE_PROMPTS = {
  butler: `你是孟一的數位管家，負責管理他的數位大腦（記憶庫）。`,
  engineer: `你是孟一的資深工程師夥伴，主要服務 DropOut 技術體系。`,
  pm: `你是孟一的產品策略夥伴。`,
  coach: `你是孟一的超級助理 เหมยหลาน (Meilan)，嚴格、批判、絕對忠誠。`,
  analyst: `你是孟一的數據分析師。`,
  code_reviewer: `你是資深 Code Review 專家。`,
  researcher: `你是孟一的研究員，負責搜尋最新資訊。`,
  security_auditor: `你是 OWASP Top 10 資安專家。`,
}

export function getRegistryState() {
  const base = loadAgentsConfig()
  const overlay = loadStaffOverlay()
  const disabled = new Set(overlay.disabled_base ?? [])
  const mergedAgents = { ...(base.agents ?? {}) }

  for (const id of disabled) {
    if (mergedAgents[id]) mergedAgents[id] = { ...mergedAgents[id], _disabled: true }
  }

  for (const [id, cfg] of Object.entries(overlay.agents ?? {})) {
    if (cfg?._deleted) {
      delete mergedAgents[id]
      continue
    }
    mergedAgents[id] = { ...(mergedAgents[id] ?? {}), ...cfg, _custom: true }
  }

  return { base, overlay, merged: { ...base, agents: mergedAgents } }
}

export function listStaff() {
  const { merged, overlay } = getRegistryState()
  const out = []
  for (const [id, cfg] of Object.entries(merged.agents ?? {})) {
    if (id === 'orchestrator' || id.includes('/')) continue
    if (cfg._disabled) continue
    out.push({
      id,
      display: cfg.display ?? id,
      icon: cfg.icon ?? '🤖',
      description: cfg.description ?? cfg.mandate ?? '',
      model: cfg.model ?? null,
      custom: !!cfg._custom,
      org: cfg.org ?? 'personal',
      trust: cfg.trust ?? 'internal',
    })
  }
  return { staff: out, disabled: overlay.disabled_base ?? [], updated_at: overlay.updated_at }
}

export function getAvailableAgentIds() {
  return listStaff().staff.map(s => s.id).filter(id => id !== 'assistant')
}

export function getAgentMeta(id) {
  const { merged } = getRegistryState()
  const cfg = merged.agents?.[id]
  if (!cfg || cfg._disabled) return null
  return { icon: cfg.icon ?? '🤖', display: cfg.display ?? id }
}

export function getAgentModel(id) {
  const { merged } = getRegistryState()
  return merged.agents?.[id]?.model ?? null
}

export function buildAgentSystem(id) {
  const { merged } = getRegistryState()
  const cfg = merged.agents?.[id]
  if (!cfg || cfg._disabled) return null
  const role = cfg.mandate ?? cfg.description ?? BASE_ROLE_PROMPTS[id] ?? `你是孟一的 ${cfg.display ?? id}。`
  const caveman = subAgentStyleBlock(id)
  return `${MENGYI_BRIEF}\n${ONEAI_SYSTEM_ARCHITECTURE}\n${role}${caveman}`
}

export function getAgentSystemsMap() {
  const systems = {}
  for (const id of getAvailableAgentIds()) {
    systems[id] = buildAgentSystem(id)
  }
  return systems
}

export function getRoutingTriggers() {
  const { merged } = getRegistryState()
  const base = merged.agents?.orchestrator?.routing_triggers ?? {}
  const overlay = loadStaffOverlay()
  const out = { ...base }
  for (const [id, cfg] of Object.entries(overlay.agents ?? {})) {
    if (cfg?._deleted || cfg?._disabled) continue
    if (Array.isArray(cfg.routing_keywords)) out[id] = cfg.routing_keywords
    else if (Array.isArray(cfg.triggers)) out[id] = cfg.triggers
  }
  return out
}

function validateAgentId(id) {
  if (!id || typeof id !== 'string') return '缺少 agent id'
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(id)) return 'id 須為小寫英數、底線、連字號'
  if (id === 'orchestrator' || id === 'coach') return '不可修改核心營運長 coach'
  return null
}

export function addStaffMember(input) {
  const err = validateAgentId(input.id)
  if (err) return { ok: false, error: err }
  if (!input.display?.trim()) return { ok: false, error: '缺少 display 名稱' }
  if (!input.mandate?.trim() && !input.description?.trim()) {
    return { ok: false, error: '新增議員須有 mandate 或 description' }
  }

  const { maxStaff } = getCouncilLimits()
  const current = listStaff().staff.length
  if (current >= maxStaff) {
    return { ok: false, error: `編制已滿（上限 ${maxStaff} 人），請先刪除或停用議員` }
  }

  const overlay = loadStaffOverlay()
  overlay.agents = overlay.agents ?? {}
  overlay.agents[input.id] = {
    display: input.display.trim(),
    icon: input.icon ?? '🧑‍💼',
    mandate: (input.mandate ?? input.description ?? '').trim(),
    description: (input.description ?? input.mandate ?? '').trim(),
    model: input.model ?? 'google/gemini-2.5-flash',
    org: input.org ?? 'personal',
    trust: input.trust ?? 'internal',
    routing_keywords: input.routing_keywords ?? input.triggers ?? [],
    created_at: new Date().toISOString(),
    created_by: 'coo',
  }
  overlay.disabled_base = (overlay.disabled_base ?? []).filter(x => x !== input.id)
  saveStaffOverlay(overlay)
  return { ok: true, staff: listStaff() }
}

export function removeStaffMember(id) {
  const err = validateAgentId(id)
  if (err) return { ok: false, error: err }
  const overlay = loadStaffOverlay()
  const base = loadAgentsConfig()
  if (overlay.agents?.[id]) {
    delete overlay.agents[id]
  } else if (base.agents?.[id] && id !== 'coach') {
    overlay.disabled_base = [...new Set([...(overlay.disabled_base ?? []), id])]
  } else {
    return { ok: false, error: `找不到議員 ${id}` }
  }
  saveStaffOverlay(overlay)
  return { ok: true, staff: listStaff() }
}

export function updateStaffMember(id, patch) {
  const err = validateAgentId(id)
  if (err) return { ok: false, error: err }
  const overlay = loadStaffOverlay()
  const base = loadAgentsConfig()
  const existing = overlay.agents?.[id] ?? base.agents?.[id]
  if (!existing) return { ok: false, error: `找不到議員 ${id}` }

  overlay.agents = overlay.agents ?? {}
  overlay.agents[id] = {
    ...(overlay.agents[id] ?? {}),
    ...(patch.display ? { display: patch.display.trim() } : {}),
    ...(patch.icon ? { icon: patch.icon } : {}),
    ...(patch.mandate ? { mandate: patch.mandate.trim(), description: patch.mandate.trim() } : {}),
    ...(patch.description ? { description: patch.description.trim() } : {}),
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.routing_keywords ? { routing_keywords: patch.routing_keywords } : {}),
    updated_at: new Date().toISOString(),
    updated_by: 'coo',
  }
  if (overlay.disabled_base?.includes(id)) {
    overlay.disabled_base = overlay.disabled_base.filter(x => x !== id)
  }
  saveStaffOverlay(overlay)
  return { ok: true, staff: listStaff() }
}

export function restoreStaffMember(id) {
  const overlay = loadStaffOverlay()
  if (!(overlay.disabled_base ?? []).includes(id)) {
    return { ok: false, error: `${id} 不在停用名單` }
  }
  overlay.disabled_base = overlay.disabled_base.filter(x => x !== id)
  saveStaffOverlay(overlay)
  return { ok: true, staff: listStaff() }
}

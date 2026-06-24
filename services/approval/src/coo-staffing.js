/**
 * COO Staffing — 人事管理 + 議會編制
 */
import {
  addStaffMember,
  removeStaffMember,
  updateStaffMember,
  restoreStaffMember,
  listStaff,
  getAvailableAgentIds,
  getRoutingTriggers,
} from './agent-registry.js'
import { pickSquadForMessage, pickAdHocExperts, getCouncilLimits } from './agent-council.js'

const STAFF_INTENT_RE = /(?:新增|加入|聘请|聘請|雇用|創建|创建|add)\s*(?:一個|一个|一位|名)?\s*(?:agent|Agent|議員|议员|專家|专家|員工|员工)/i
const STAFF_REMOVE_RE = /(?:刪除|删除|移除|開除|开除|解僱|解聘|fire|remove|delete)\s*(?:agent|Agent|議員|议员|專家|专家|員工|员工)?\s*[:：]?\s*([a-z][a-z0-9_-]{1,31})?/i
const STAFF_LIST_RE = /(?:列出|名单|名單|編制|编制|有哪些|人事|員工列表|员工列表|office roster|staff list)/i
const STAFF_UPDATE_RE = /(?:修改|更新|調整|调整|訓練|训练|train)\s*(?:agent|Agent|議員|议员|專家|专家)?\s*[:：]?\s*([a-z][a-z0-9_-]{1,31})/i
const STAFF_RESTORE_RE = /(?:恢復|恢复|restore|復職|复职)\s*(?:agent|Agent|議員|议员)?\s*[:：]?\s*([a-z][a-z0-9_-]{1,31})/i

export function isStaffManagementIntent(userMsg) {
  const t = String(userMsg ?? '')
  return STAFF_INTENT_RE.test(t) || STAFF_REMOVE_RE.test(t) || STAFF_LIST_RE.test(t)
    || STAFF_UPDATE_RE.test(t) || STAFF_RESTORE_RE.test(t)
}

function slugify(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
    || `expert-${Date.now().toString(36)}`
}

export function parseStaffCommand(userMsg) {
  const t = String(userMsg ?? '').trim()
  if (STAFF_LIST_RE.test(t)) return { action: 'list' }

  const restoreM = t.match(STAFF_RESTORE_RE)
  if (restoreM?.[1]) return { action: 'restore', id: restoreM[1] }

  if (/刪|删|移除|開除|开除|解僱|解聘|fire|remove|delete/i.test(t)) {
    const removeM = t.match(STAFF_REMOVE_RE)
    const id = removeM?.[1] ?? t.match(/(?:議員|议员|agent|專家|专家)\s*[:：]?\s*([a-z][a-z0-9_-]{1,31})/i)?.[1]
    if (id) return { action: 'remove', id }
  }

  const updateM = t.match(STAFF_UPDATE_RE)
  if (updateM?.[1]) {
    const mandateM = t.match(/(?:職責|职责|mandate|改為|改为)[:：]\s*(.+)/i)
    const displayM = t.match(/(?:叫做|名稱|名称|display)[:：]\s*(.+)/i)
    return {
      action: 'update',
      id: updateM[1],
      patch: {
        ...(mandateM ? { mandate: mandateM[1].trim() } : {}),
        ...(displayM ? { display: displayM[1].trim() } : {}),
      },
    }
  }

  if (STAFF_INTENT_RE.test(t)) {
    const nameM = t.match(/(?:叫做|名稱|名称|叫)\s*[「"']?([^「」"'，,\n]+)[」"']?/i)
      ?? t.match(/(?:新增|加入|聘请|聘請)\s*(?:一個|一个|一位)?\s*([^，,\n：:]{2,20})/i)
    const mandateM = t.match(/(?:職責|职责|負責|负责|mandate)[:：]\s*(.+)/i)
    const display = nameM?.[1]?.trim() ?? '新專家'
    const idM = t.match(/id\s*[:：]\s*([a-z][a-z0-9_-]{1,31})/i)
    return {
      action: 'add',
      id: idM?.[1] ?? slugify(display),
      display,
      mandate: mandateM?.[1]?.trim() ?? `提供 ${display} 領域建議；超出職責須拒絕。`,
    }
  }
  return null
}

export function executeStaffCommand(cmd) {
  if (!cmd) return { ok: false, error: '無法解析人事指令' }
  switch (cmd.action) {
    case 'list': return { ok: true, staff: listStaff() }
    case 'add': return addStaffMember(cmd)
    case 'remove': return removeStaffMember(cmd.id)
    case 'update': return updateStaffMember(cmd.id, cmd.patch ?? {})
    case 'restore': return restoreStaffMember(cmd.id)
    default: return { ok: false, error: '未知人事動作' }
  }
}

export function formatStaffListReply(staffData) {
  const { staff, disabled } = staffData
  const lines = staff.map(s =>
    `- ${s.icon} **${s.display}** (\`${s.id}\`)${s.custom ? ' · 自訂' : ' · 常駐'}`,
  )
  const off = (disabled ?? []).length ? `\n\n⏸ 已停用：${disabled.join('、')}` : ''
  return `📋 **數位辦公室編制**（${staff.length} 位）\n${lines.join('\n')}${off}`
}

export function formatStaffActionReply(cmd, result) {
  if (!result.ok) return `⚠️ 人事異動失敗：${result.error}`
  switch (cmd.action) {
    case 'add': return `✅ 已新增 **${cmd.display}**（\`${cmd.id}\`）。`
    case 'remove': return `✅ 已移出 \`${cmd.id}\`。`
    case 'update': return `✅ 已更新 \`${cmd.id}\`。`
    case 'restore': return `✅ 已恢復 \`${cmd.id}\`。`
    case 'list': return formatStaffListReply(result.staff)
    default: return '✅ 完成。'
  }
}

export function buildCouncilRoster(userMsg, routedIds) {
  const adHocTriggered = pickAdHocExperts(userMsg)
  for (const expert of adHocTriggered) {
    if (!getAvailableAgentIds().includes(expert.id)) {
      addStaffMember({
        id: expert.id,
        display: expert.display ?? expert.id,
        icon: expert.icon ?? '🧑‍💼',
        mandate: expert.mandate ?? '',
        routing_keywords: expert.triggers ?? [],
      })
    }
  }

  const available = new Set(getAvailableAgentIds())
  let ids = [...new Set(routedIds ?? [])].filter(id => available.has(id))

  const squad = pickSquadForMessage(userMsg)
  if (squad?.members) {
    for (const m of squad.members) {
      if (m !== 'coach' && available.has(m) && !ids.includes(m)) ids.push(m)
    }
  }
  for (const expert of pickAdHocExperts(userMsg)) {
    if (available.has(expert.id) && !ids.includes(expert.id)) ids.push(expert.id)
  }

  return {
    agentIds: [...new Set(ids)].filter(id => id !== 'coach').slice(0, getCouncilLimits().maxCouncilParticipants),
    squad: squad?.id ?? null,
    squad_display: squad?.display ?? null,
  }
}

export function detectAgentsFromRegistry(text) {
  const t = text.toLowerCase()
  const matched = []
  for (const [agentId, keywords] of Object.entries(getRoutingTriggers())) {
    if (!Array.isArray(keywords)) continue
    if (keywords.some(kw => t.includes(String(kw).toLowerCase()))) matched.push(agentId)
  }
  return matched.filter(id => getAvailableAgentIds().includes(id))
}

export async function planStaffingWithLLM(deps, userMsg, memoryBlock) {
  const { callOpenRouter, MENGYI_BRIEF } = deps
  const staff = listStaff().staff.filter(s => s.id !== 'coach')
  const roster = staff.map(s => `- ${s.id}: ${s.display}`).join('\n')
  const prompt = `${MENGYI_BRIEF}${memoryBlock}
你是梅蘭 COO。選 1-4 位議員 id（來自編制），返回 JSON：{"agent_ids":[],"reason":""}
編制：\n${roster}\n孟一：「${userMsg}」`

  try {
    const r = await callOpenRouter('google/gemini-2.5-flash', [{ role: 'user', content: prompt }])
    const parsed = JSON.parse(r.reply.trim().replace(/```json?|```/g, '').trim())
    return {
      agentIds: (parsed.agent_ids ?? []).filter(id => getAvailableAgentIds().includes(id)),
      reason: parsed.reason ?? '',
    }
  } catch {
    return { agentIds: detectAgentsFromRegistry(userMsg), reason: 'fallback' }
  }
}
